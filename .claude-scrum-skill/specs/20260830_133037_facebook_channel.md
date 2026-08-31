# Facebook Channel (Auto-DM + Comment Support) Specification

- **Date:** 2026-08-30 (PT)
- **Repo:** openreply — fork `origin=CricsConCarne/openreply`, `upstream=diwenne/openreply` (fork 5 commits ahead; FB work is a branch on the fork)
- **Branch:** `facebook-channel-v1` off fork `main`
- **Source:** `.claude-cliff-notes/2026-08-30_facebook-channel-feasibility.md` (feasibility verdict: feasible, ~80% pipeline reuse, **no App Review required** for running your own Pages)
- **Stack:** Next.js 16 App Router, Prisma 7 (generated client at `app/generated/prisma`), Postgres, BullMQ + Redis, NextAuth v5, vitest

## Overview

OpenReply automates Instagram comment→DM funnels: a keyword-matched comment triggers a private
reply (optionally a button template), a postback reveals the link message, with public comment
replies, delayed follow-ups, DM keyword triggers, link tracking, and workspace billing around it.
The pipeline (keyword matcher, rate limiter, dedup, BullMQ worker, tracking, workspaces) is
platform-neutral; Instagram specificity is concentrated in four places — Graph API access
(`lib/meta/client.ts`), webhook parsing (`lib/meta/webhook.ts`), OAuth (`lib/meta/oauth.ts`), and
naming (717 `instagram` refs across 78 files; 41 non-generated source files reference
`InstagramAccount`/`instagramId`).

This spec adds **Facebook Pages as a second channel** behind a channel-provider seam: one schema
(`InstagramAccount` → `SocialAccount` + `platform`), one provider interface with an Instagram and a
Facebook implementation, webhook dispatch by `object`, and platform-aware UI. Facebook's messaging
API is shape-identical to Instagram's for every capability the product uses (private reply by
`comment_id`, 7-day window, button/web_url templates, postbacks, read receipts); the deltas are the
comment webhook (`page`/`feed`, noisy), the follow gate (no FB equivalent — must degrade visibly),
the post listing (two calls), and token lifecycle (Page tokens never expire).

App Review is **not** in scope or required: the same App Roles escape hatch used for the current
Instagram tester setup applies to Facebook (add the FB account as Admin/Developer/Tester,
`pages_messaging` works under Standard Access). Meta's Advanced Access rule governs the
**recipient** and is identical for IG and FB, so Facebook introduces no ceiling not already present
on Instagram.

## Objectives

Primary:

- Connect a Facebook Page and run comment→DM automations on it with parity for every capability FB
  supports: private reply (plain/button/link-button), reveal on postback, read-receipt fallback,
  public comment reply, DM keyword trigger, delayed follow-up, link tracking, DmLog/usage billing.
- Zero Instagram regression: every existing IG behavior unchanged; full existing suite green at
  every story boundary.
- One pipeline: worker flows, matcher, rate limiter, dedup, billing untouched — platform is
  resolved once through a provider seam, never branched on inside flow bodies.

Secondary:

- Simpler token lifecycle for FB (Page tokens from a long-lived user token never expire; refresh
  cron becomes IG-only).
- Follower-chart parity via `fan_count` snapshots.
- Self-hoster docs for the FB path (setup, App Roles, no-review rationale).

## Ubiquitous Language

| Term | Meaning |
|---|---|
| Social account | A connected channel identity: an IG professional account or a FB Page. One row of `SocialAccount`. |
| Platform | `INSTAGRAM` or `FACEBOOK`. Determines which channel provider handles an account. |
| External id | The platform's id for the account (IG professional-account id / FB Page id). Appears as `entry.id` in webhooks. |
| Channel provider | The adapter implementing messaging/comment/post operations for one platform. |
| Automation (campaign) | Keyword-triggered comment→DM flow bound to one social account. |
| Private reply | The single DM Meta permits in reply to a comment, within 7 days. |
| Opening DM / reveal | Button-template first message; tapping its postback (or a read-receipt fallback) delivers the link ("reveal") message. |
| Follow gate | IG-only check (`is_user_follow_business`) that a commenter follows before the reveal. **No FB equivalent.** |
| Reconciler | Polling safety net in the worker that sweeps recent comments webhooks missed. |
| Feed noise | Non-comment `page`/`feed` webhook events (likes, shares, statuses, edits, removes, reactions) that must never reach the queue. |

## Current Architecture (grounding)

| Layer | File | FB reuse |
|---|---|---|
| OAuth | `lib/meta/oauth.ts` | state HMAC + AES-GCM token crypto reused; IG authorize/exchange stays; FB gets its own module |
| Graph calls | `lib/meta/client.ts` (774 L) | ~60% — errors/`handleResponse`/shapes reused; send/read functions get FB twins |
| Webhook parse | `lib/meta/webhook.ts` | signature verify already dual-secret; comment parser is IG-only; messaging parsers gate on `object === "instagram"` |
| Webhook route | `app/api/webhook/route.ts` | mostly ok — needs dispatch by `object` |
| Worker | `lib/queue/dm-worker.ts` (1294 L) | logic intact — 4 processors (`comment`, `postback`, `followup`, `message`) look up accounts by platform id and call client functions directly |
| Reconciler | `lib/polling/comment-reconciler.ts` (274 L) | logic intact — needs provider-backed comment/post fetch |
| Account helper | `lib/instagram-accounts.ts` | rename + platform-aware |
| keyword-matcher, rate-limiter, tracking, dedup, usage, workspaces | `lib/utils/*`, `lib/tracking/*`, `lib/billing/*` | untouched |
| Connect UI | `app/(dashboard)/settings/page.tsx`, `components/account-select.tsx` | add FB connect + badges |
| Campaign builder | `components/campaign-builder.tsx` (1022 L) | platform-aware follow-gate + post picker |
| Overview | `app/(dashboard)/overview/page.tsx`, `components/follower-chart.tsx` | fan-count series |

Job payloads (`lib/queue/client.ts`) carry the **platform id** (`instagramAccountId` = webhook
`entry.id`), and processors resolve `automation.instagramAccount` by it. Webhook signature
verification already accepts either `FACEBOOK_APP_SECRET` or `INSTAGRAM_APP_SECRET`;
`FACEBOOK_APP_SECRET` is already in `serverEnvSchema`.

## IG → FB Capability Map

| Capability | IG today | Facebook Page | Delta |
|---|---|---|---|
| Private reply to comment | `POST graph.instagram.com/{ig-id}/messages`, `recipient:{comment_id}` | `POST graph.facebook.com/{page-id}/messages`, same shape | identical |
| 7-day window, one message only | yes | yes | none |
| Button template + postback | yes | Messenger, richer | none |
| `web_url` buttons (≤3, title ≤20, text ≤640) | yes | yes | none |
| Public comment reply | `/{comment-id}/replies` | `/{comment-id}/comments` | path differs |
| Comment webhook | `object:instagram`, `field:comments` | `object:page`, `field:feed`, `value.item=="comment" && verb=="add"` | new parser + hard filter (feed fires on likes/shares/statuses too) |
| DM / postback / read webhooks | `entry.messaging[]` | same `entry.messaging[]` shape | parser shared |
| Signature verify | accepts IG **or** FB secret | — | already done |
| Reels | `media_product_type` | Meta treats Reels as posts; same feed webhook | covered |
| Follow gate (`is_user_follow_business`) | IG only | **no equivalent** | disable per-channel, visibly |
| Follower chart | `follower_count` insights | `fan_count` | separate impl |
| Post picker | `/me/media` | `/{page-id}/published_posts` + `/{page-id}/video_reels` | two calls |
| Token lifecycle | 60d + refresh cron | Page token from long-lived user token **never expires** | cron becomes IG-only |

## Requirements

### Functional

- **FR-1 Connect.** A workspace manager connects a Facebook Page: FB Login for Business dialog →
  code → short user token → `fb_exchange_token` long-lived user token → `GET /me/accounts` → Page
  picker → per-Page token stored AES-GCM-encrypted on a `SocialAccount(platform=FACEBOOK)` row;
  webhook subscription (`feed,messages,messaging_postbacks,message_reads`) established via
  `POST /{page-id}/subscribed_apps` during connect, mirroring the IG `webhookSubscribed` handling.
- **FR-2 Comment trigger.** A new FB comment on a campaign's post (or any post for `matchAnyPost`)
  that matches keywords produces exactly the IG flow: private reply (plain / button / link-button
  per campaign config), public comment reply, DmLog row, usage increment, rate-limit reservation,
  tracked links.
- **FR-3 Reveal mechanics.** Postback taps deliver the reveal; read receipts schedule the 5-minute
  fallback; `followUpDelayMinutes` follow-ups fire — all unchanged, on FB Messenger events.
- **FR-4 DM keyword trigger.** Inbound Page messages matching a `dmTriggerEnabled` campaign's
  keywords get the autoreply, with the same echo/deleted/unsupported filtering.
- **FR-5 Follow gate is IG-only.** Hidden in the builder for FB accounts (with a one-line
  explainer); the automations API rejects `requireFollow=true` for FACEBOOK accounts; if the worker
  ever meets an FB automation with the flag set it proceeds without the gate and writes an
  `OperationalEvent` WARNING (degrade visibly, never silently no-op).
- **FR-6 Reconciler.** The polling sweep covers FB campaigns with the same lookback, per-sweep cap,
  owner-replied check (FB replies are the nested `comments` edge), and DmLog handled-check.
- **FR-7 Post picker.** Lists Page posts and Reels (merged, newest first) with
  thumbnail/caption/date parity where FB provides them (`full_picture`, `message`).
- **FR-8 Follower chart.** Daily `FollowerSnapshot` rows for FB accounts from Page `fan_count`;
  overview renders the series labeled appropriately. No backfill (FB has no
  30-day `follower_count` insight to reconstruct from).
- **FR-9 Platform visibility.** Every place an account is shown (settings list, account select,
  campaign builder, logs, overview) carries a platform badge.
- **FR-10 Dedup holds.** FB comment ids (`{postid}_{commentid}`) are globally unique; the
  `DmLog @@unique([automationId, commentId])` guard, the ProcessedComment dedup set, and the
  deterministic BullMQ job ids (`comment_<externalId>_<commentId>` — no colons in FB ids) all hold
  unchanged.
- **FR-11 Token lifecycle.** FB rows store `tokenExpiresAt = null`; the refresh cron only selects
  `platform=INSTAGRAM` rows (its query already requires a non-null expiry — add the platform filter
  to make the intent explicit).

### Non-functional

- **N-1 Data-preserving migration.** All renames are hand-written SQL (`ALTER TABLE … RENAME`,
  `RENAME COLUMN`), never Prisma's default drop-and-recreate; verified by row counts and FK
  integrity on a seeded copy before it touches a real database.
- **N-2 Feed-noise immunity.** Only `item=="comment" && verb=="add"` events from `field:"feed"`
  enter the queue; likes, shares, statuses, reactions, edits, removes, and Page-authored comments
  are dropped in the parser with fixture tests proving each.
- **N-3 Secrets.** Page tokens encrypted with the existing AES-256-GCM helpers; long-lived user
  token held only transiently (encrypted, short-TTL) during the Page-picker step, never persisted.
- **N-4 Signature verification unchanged** (already accepts both app secrets).
- **N-5 Seam discipline.** No `if (platform === …)` inside worker flow bodies, routes, or the
  reconciler; platform varies only at provider resolution and in the webhook parsers.
- **N-6 TDD.** Red-green-refactor per the engineering baseline; Graph calls tested against mocked
  `fetch` fixtures; suite stays fast (vitest, no network).
- **N-7 Standard Access only.** Nothing in the product may depend on Advanced Access, App Review,
  or Business Verification.

## Technical Specifications

### Schema delta (data-preserving)

```prisma
enum SocialPlatform {
  INSTAGRAM
  FACEBOOK
}

model SocialAccount {            // was InstagramAccount
  id                String         @id @default(cuid())
  workspaceId       String
  platform          SocialPlatform @default(INSTAGRAM)
  externalId        String         // was instagramId; IG account id or FB Page id
  username          String         // FB: Page name (vanity username when present)
  name              String?
  accessToken       String
  tokenExpiresAt    DateTime?      // null for FACEBOOK (Page tokens don't expire)
  webhookSubscribed Boolean        @default(false)
  ...
  @@unique([platform, externalId])
}
```

- FK renames on `Automation`, `DmLog`, `LinkClick`, `FollowerSnapshot`:
  `instagramAccountId` → `socialAccountId`, relation `instagramAccount` → `socialAccount`.
  `ProcessedComment.instagramAccountId` (a bare string, no FK) → `socialAccountId`.
- **Design decision:** uniqueness widens from `externalId` alone to `[platform, externalId]` —
  every lookup is platform-scoped because the webhook `object` (and job payload) always names the
  platform. IG and FB ids likely never collide, but the compound key makes that a non-assumption.
- Queue payloads: `instagramAccountId` → `externalAccountId` + new `platform` field on all four job
  interfaces. **Rollout note:** in-flight Redis jobs written before the deploy carry the old field
  name — drain the queue at deploy (self-hosted, own accounts; acceptable) rather than shipping a
  compatibility shim.
- `requireFollow` and friends stay on `Automation` (IG semantics); enforcement is per FR-5, not a
  schema change.
- Route paths under `/api/instagram/*` keep their URLs for IG connect/disconnect; the shared reads
  (`posts`, `conversations`, `overview`, `accounts`) become platform-aware and their
  `instagramAccountId` query param renames to `socialAccountId` (internal API, single UI caller —
  both sides change together, no alias).

### Channel provider seam

`lib/channels/{types,instagram,facebook,index}.ts`:

```ts
interface ChannelProvider {
  platform: SocialPlatform;
  sendPrivateReply(p: PrivateReplyParams): Promise<SendResult>;          // + WithButton, WithLinkButton
  sendDirectMessage(p: DirectMessageParams): Promise<SendResult>;        // + WithButton, WithLinkButton
  replyToComment(p: CommentReplyParams): Promise<void>;
  getRecentComments(p: RecentCommentsParams): Promise<ChannelComment[]>; // normalized: id, text, author, timestamp, ownerReplied
  listPosts(p: ListPostsParams): Promise<ChannelPost[]>;
  getConversations(p: ConversationsParams): Promise<ChannelConversation[]>;
  subscribeWebhooks(p: SubscribeParams): Promise<{ success: boolean }>;
  getFollowStatus(p: FollowStatusParams): Promise<boolean | null>;      // FACEBOOK: always null
  refreshToken(p: RefreshParams): Promise<TokenRefresh | null>;         // FACEBOOK: null (no-op)
}

function resolveChannel(platform: SocialPlatform): ChannelProvider;
```

- Params objects (>2 args everywhere) per the baseline.
- The Instagram provider **delegates to the existing `lib/meta/client.ts` functions** — no
  behavioral rewrite, a thin adapter. The Facebook provider is new code against
  `graph.facebook.com`, sharing `handleResponse` and the `MetaApiError` family.
- `getRecentComments` normalizes the reply-edge difference (IG `replies.data[].from.id` vs FB
  nested `comments.data[].from.id`) into an `ownerReplied` boolean so the reconciler stays
  platform-neutral.
- Worker processors, reconciler, and routes call `resolveChannel(account.platform)` once and use
  the interface; follow-gating asks `getFollowStatus` and treats `null` per existing IG semantics
  (caller decides), with the FR-5 warning path for misconfigured FB automations.

### Facebook OAuth & connect flow

`lib/meta/facebook-oauth.ts` + `app/api/facebook/{connect,callback,pages}/route.ts`:

1. `GET /api/facebook/connect` — guards mirror the IG route (session, `canManageWorkspace`, env
   preflight via a `getMissingFacebookOAuthEnv` analog) → redirect to
   `https://www.facebook.com/{version}/dialog/oauth` with `client_id=FACEBOOK_APP_ID`,
   `redirect_uri=/api/facebook/callback`, HMAC `state` (reuse `createOAuthState`), scopes
   `pages_show_list,pages_messaging,pages_read_engagement,pages_manage_engagement,pages_manage_metadata`.
2. `GET /api/facebook/callback` — verify state → `GET graph.facebook.com/oauth/access_token` (code
   → short user token) → `grant_type=fb_exchange_token` (→ long-lived user token, ~60d) → stash the
   long-lived user token in an **encrypted httpOnly cookie with a 10-minute TTL** (AES-GCM helpers;
   never persisted) → redirect to the Page-picker step in settings.
3. `GET /api/facebook/pages` — reads the cookie, `GET /me/accounts?fields=id,name,access_token,category`,
   returns the pickable Pages (marking any already connected to another workspace).
4. `POST /api/facebook/pages` — selected Page → encrypt its `access_token` (never expires) →
   upsert `SocialAccount { platform: FACEBOOK, externalId: pageId, tokenExpiresAt: null }` with the
   `canConnect` cross-workspace guard → `POST /{page-id}/subscribed_apps` with
   `subscribed_fields=feed,messages,messaging_postbacks,message_reads` (page token) → clear the
   cookie → redirect with `?facebook=` status codes mirroring the `?instagram=` pattern.

Env: add `FACEBOOK_APP_ID` (`FACEBOOK_APP_SECRET` already required by `serverEnvSchema`).

### Webhook dispatch & parsing

- `app/api/webhook/route.ts`: keep GET verification and signature check as-is; dispatch POST by
  `payload.object` — `"instagram"` → existing parsers; `"page"` → `parseFacebookCommentEvents` +
  the (generalized) messaging parsers. Unknown objects: record `WebhookEvent`, return 200.
- `parseFacebookCommentEvents` — `entry.changes[]` where `field === "feed"`; **hard filter**
  `value.item === "comment" && value.verb === "add"`; require `comment_id`, `post_id`, `from.id`
  (comments from privacy-restricted users lacking `from` are skipped — the pipeline needs a
  commenter identity); drop Page-authored comments (`from.id === entry.id`); map `post_id` →
  `mediaId`. No ad indirection on FB v1 (`originalMediaId` stays IG-only).
- `parseMessageEvents` / `parsePostbackEvents` / `parseReadEvents`: the `entry.messaging[]` shape
  is identical on both platforms — replace the `object !== "instagram"` early-out with acceptance
  of `"instagram" | "page"`, and thread the derived `platform` into the emitted events/jobs.
- Account lookup everywhere moves to `findUnique({ where: { platform_externalId } })`.

### Facebook Graph endpoints (provider implementation)

| Operation | Call |
|---|---|
| Private reply / DM / templates | `POST /{page-id}/messages` — `recipient:{comment_id}` or `{id}`; button/web_url payloads byte-identical to IG (text ≤640, title ≤20, ≤3 buttons) |
| Public comment reply | `POST /{comment-id}/comments` `{message}` |
| Recent comments | `GET /{post-id}/comments?fields=id,message,from{id,name},created_time,comments{from{id}}` (paginate within lookback) |
| List posts | `GET /{page-id}/published_posts?fields=id,message,full_picture,created_time,permalink_url` + `GET /{page-id}/video_reels` — merge, sort desc |
| Conversations | `GET /{page-id}/conversations?fields=participants,messages{…}` |
| Fan count | `GET /{page-id}?fields=fan_count` |
| Subscribe | `POST /{page-id}/subscribed_apps` |

## Architecture (data flow)

```
FB user comments on Page post
  → Meta webhook POST /api/webhook  (object:"page", field:"feed")
  → signature verify (existing) → parseFacebookCommentEvents (hard noise filter)
  → BullMQ job { platform:"FACEBOOK", externalAccountId:<pageId>, commentId, … }
  → worker processComment: find automations via socialAccount{platform,externalId}
  → matchKeywords / rate-limiter / usage / DmLog  (all untouched)
  → resolveChannel(FACEBOOK).sendPrivateReply* / replyToComment
  → postback / read webhooks (entry.messaging[], shared parser) → reveal → follow-up
  → reconciler sweep (worker interval) via provider.getRecentComments as safety net
```

System boundaries: Meta Graph API stays wrapped behind `lib/channels/*` + `lib/meta/*`; no Graph
shapes leak past the provider interface (normalized `ChannelComment`/`ChannelPost` types).

## Epics & Stories

Estimated total: **7 epics, 21 stories, 75 points** (~2 weeks eng, matching the feasibility
estimate: seam/schema 4d, FB provider + OAuth 4d, webhook + reconciler 2d, UI 2d, tests 2d).

### Epic A: platform-foundation — schema + naming generalization

Generic subdomain. No dependencies. Everything else builds on it.

- **A1 `standard-access-recipient-probe`** (cowork, 1 pt, P0) — Run the settled-before-coding
  check from the feasibility note against the production DB:
  `SELECT "commenterId","commenterName",status,"dmSentAt" FROM "DmLog" WHERE status='SENT' ORDER BY "dmSentAt" DESC LIMIT 20;`
  Strangers present ⇒ Standard Access suffices on the recipient side ⇒ FB same. Record the verdict
  in the cliff note. AC: verdict + evidence recorded; if it comes back testers-only, note that the
  ceiling already exists on IG and FB doesn't worsen it (build proceeds either way).
- **A2 `social-account-migration`** (claude, 5 pt, P0) — Prisma schema per the delta above; ONE
  hand-written SQL migration using renames (`ALTER TABLE "InstagramAccount" RENAME TO
  "SocialAccount"`, `RENAME COLUMN`, enum + `platform` column default `INSTAGRAM`, index/constraint
  renames, compound unique). AC: migration applied to a seeded copy preserves every row and FK
  (counts asserted); `prisma migrate diff` shows no drop/create of renamed tables; existing rows
  read back as `platform=INSTAGRAM`.
- **A3 `codebase-rename-sweep`** (claude, 5 pt, P0, blocked_by A2) — Regenerate the client; sweep
  the ~41 source files: `instagramAccount(Id)` → `socialAccount(Id)`, `instagramId` →
  `externalId`, `lib/instagram-accounts.ts` → `lib/social-accounts.ts`
  (`getWorkspaceSocialAccount`, `canConnectSocialAccount`), queue payloads →
  `{platform, externalAccountId}`, shared route param rename. AC: `tsc --noEmit`, eslint, and the
  full vitest suite green; zero remaining references to the old Prisma identifiers outside
  migrations; deploy note about draining in-flight Redis jobs recorded in the PR description.
- **A4 `facebook-env-plumbing`** (claude, 2 pt, P1) — `FACEBOOK_APP_ID` in `serverEnvSchema`,
  `getMissingFacebookOAuthEnv`, `.env.example`/docs rows. AC: env tests cover missing/present
  matrix mirroring the IG preflight.

### Epic B: channel-provider-seam — one pipeline, resolved per platform

Core subdomain (the automation pipeline is the product's heart; this epic makes its delivery
polymorphic). Depends on: platform-foundation.

Candidate pattern: `Strategy — because message-send/comment-read/token-refresh semantics vary per
platform behind one contract the worker consumes; revisit at build (two providers may stay a plain
keyed object literal — that IS the strategy map, keep it that simple)`. Each provider is an
`Adapter — because two Graph dialects (graph.instagram.com vs graph.facebook.com) must present one
normalized contract; revisit at build (may collapse into the strategy implementations
themselves)`.

Domain sketch (core): aggregate root `Automation` (delivery invariants: at most one private reply
per comment — `DmLog @@unique([automationId, commentId])`; public reply idempotent via
`publicReplySentAt`; plan/rate limits reserved before send). Entity: `SocialAccount`. Value
objects: `ChannelIdentity {platform, externalId}`, normalized `ChannelComment`/`ChannelPost`.
Business rules stay in the worker; providers stay I/O-only.

- **B1 `channel-contract-and-instagram-provider`** (claude, 5 pt, P0) — `lib/channels/types.ts`
  contract + `resolveChannel` registry + Instagram provider delegating to `lib/meta/client.ts`.
  AC: contract unit-tested through the IG provider against mocked fetch; `getFollowStatus` and
  `refreshToken` behaviors preserved bit-for-bit; no call site changes yet.
- **B2 `worker-on-the-seam`** (claude, 8 pt, P0, blocked_by B1) — All four processors +
  `sendRevealDirectMessage` resolve a provider from the job's `platform`; follow-gate flow guarded
  per FR-5. AC: zero platform conditionals in flow bodies (grep-asserted in a test or review
  checklist); existing `dm-worker.test.ts` green unmodified except construction; new tests for
  platform resolution and the FB `requireFollow` warning path.
- **B3 `reconciler-and-routes-on-the-seam`** (claude, 5 pt, P0, blocked_by B1) — Reconciler uses
  `provider.getRecentComments`/`listPosts` with the normalized `ownerReplied`; `posts`,
  `conversations`, `overview` routes and the token-refresh cron go through the seam (cron filters
  `platform: INSTAGRAM`). AC: reconciler tests cover both reply-edge shapes; cron test proves FB
  rows are never selected.

### Epic C: facebook-connect — OAuth + Page picker

Supporting subdomain. Depends on: platform-foundation.

- **C1 `facebook-oauth-module`** (claude, 3 pt, P0) — `lib/meta/facebook-oauth.ts`: dialog URL
  builder (scopes above), code→short-token, `fb_exchange_token`→long-lived exchanges; reuses
  state HMAC + AES-GCM helpers. AC: unit tests with mocked fetch for happy path, Meta error
  bodies, and state round-trip.
- **C2 `page-connect-routes`** (claude, 5 pt, P0, blocked_by C1) — The four-step connect flow
  (connect → callback → encrypted 10-min cookie → pages GET/POST), `SocialAccount` upsert with
  cross-workspace guard, `subscribed_apps` call, `?facebook=` redirect codes. AC: route tests for
  guard/env/state failures; cookie never outlives selection; token stored encrypted with
  `tokenExpiresAt=null`; `webhookSubscribed` reflects the subscribe result.

### Epic D: facebook-provider — Graph implementation

Supporting subdomain. Depends on: channel-provider-seam, facebook-connect.

- **D1 `facebook-messaging-sends`** (claude, 5 pt, P0) — `sendPrivateReply(+Button/+LinkButton)`,
  `sendDirectMessage(+Button/+LinkButton)` against `POST /{page-id}/messages`; Meta error mapping
  through the existing `MetaApiError`/`TokenExpiredError`/`RateLimitError`/`PermissionError`
  taxonomy. AC: fixture tests per send variant incl. 640/20-char truncation and error mapping.
- **D2 `facebook-comments-and-posts`** (claude, 3 pt, P0) — `replyToComment`,
  `getRecentComments` (nested `comments` edge → `ownerReplied`), `listPosts`
  (published_posts + video_reels merged desc), `getConversations`. AC: fixture tests incl.
  comments missing `from`, pagination within lookback, reel/post merge order.
- **D3 `facebook-fan-snapshots`** (claude, 2 pt, P2) — Snapshot cron reads `fan_count` for
  FACEBOOK rows into `FollowerSnapshot`; no backfill. AC: cron test writes one row per FB account
  per day; IG path untouched.

### Epic E: facebook-webhooks — dispatch + hard noise filter

Supporting subdomain. Depends on: channel-provider-seam, facebook-provider.

- **E1 `facebook-feed-comment-parser`** (claude, 3 pt, P0) — `parseFacebookCommentEvents` per the
  parsing spec. AC: fixture tests prove drops for like/share/status/reaction/edit/remove events,
  Page-authored comments, and missing `from`; accepted events carry
  `{platform:FACEBOOK, externalAccountId, commentId, mediaId(post_id), commenter}`.
- **E2 `webhook-dispatch-and-shared-messaging`** (claude, 3 pt, P0, blocked_by E1) — Route
  dispatch by `object`; messaging parsers accept `"page"`; account lookups by
  `[platform, externalId]`; job ids unchanged in shape. AC: end-to-end route tests enqueue the
  right jobs for object:page comment/message/postback/read payloads; object:instagram fixtures
  byte-identical behavior; unknown object → 200 + recorded WebhookEvent.

### Epic F: dual-channel-ui

Supporting subdomain. Depends on: platform-foundation, facebook-connect.

- **F1 `settings-dual-connect`** (claude, 3 pt, P1) — Second connect button, Page-picker step,
  platform badges + per-platform status notices (`?facebook=` codes), disconnect parity.
  AC: an FB account renders with badge, subscribe state, and working disconnect.
- **F2 `platform-aware-campaign-builder`** (claude, 5 pt, P1) — `account-select` badges; for a
  FACEBOOK account the follow-gate section is hidden with a one-line "Instagram-only" explainer;
  automations API rejects `requireFollow` on FB; post picker renders FB posts/reels
  (`full_picture`/`message`). AC: builder state resets `requireFollow` when switching to an FB
  account; API rejection tested; picker fixture renders both platforms.
- **F3 `platform-aware-overview`** (claude, 2 pt, P2) — Fan series labeled for FB; graceful
  "insights unavailable" states where FB lacks an IG metric. AC: overview renders both account
  types without error.

### Epic G: validation-rollout

Supporting subdomain. Depends on: all previous epics.

- **G1 `meta-app-dashboard-config`** (human, 2 pt, P0) — In the existing Meta app: add Facebook
  Login (for Business) product, set the callback redirect URI, subscribe the webhook product to
  the **Page** object with the existing callback URL + verify token, add the FB account under App
  Roles. AC: webhook GET verification succeeds for the Page object; test event received.
- **G2 `live-smoke-own-page`** (human, 3 pt, P0, blocked_by G1) — Connect the real Page; campaign
  on a real post; a second (role-less, per A1 verdict) account comments → private reply + public
  reply land; button tap reveals; DM keyword trigger replies; logs/overview populate. AC: each leg
  screenshotted/logged in the cliff note.
- **G3 `self-hoster-docs`** (claude, 2 pt, P1) — `docs/setup.md` FB section (app config, App
  Roles, scopes, no-review rationale), `META_APP_REVIEW.md` FB paragraph, README channel matrix,
  `.env.example`. AC: docs walk a fresh self-hoster to a connected Page without App Review.
- **G4 `cross-platform-hardening-fixtures`** (claude, 3 pt, P1) — Sweep the shared machinery with
  FACEBOOK fixtures: rate-limiter reservation, usage billing increment, ProcessedComment/DmLog
  dedup with `postid_commentid` ids, link tracking rows carrying `socialAccountId`. AC: one test
  per machinery seam proving platform-neutrality.

## Testing Strategy

- **Unit (vitest, mocked fetch, no network):** FB oauth exchanges; every provider method per
  platform; feed parser fixture matrix (the noise filter is the highest-risk correctness surface —
  test it exhaustively per "bugs cluster"); messaging parsers for both objects.
- **Route tests:** webhook POST end-to-end to enqueued jobs for both objects; connect flow guard
  matrix.
- **Worker tests:** platform resolution, FR-5 warning path, existing IG suite untouched-green as
  the regression oracle.
- **Migration test:** apply to a seeded copy; assert row counts, FK integrity, default platform.
- **Live smoke (G2):** the only networked validation, on own Page under App Roles.
- TDD throughout: each story starts from a failing test (engineering baseline).

## Design Passes

### Subdomain classification

| Epic | Subdomain | Rationale |
|---|---|---|
| platform-foundation | generic | Rename/migration plumbing; wide blast radius but zero domain logic |
| channel-provider-seam | core | The delivery pipeline's invariants (one reply per comment, idempotent public reply, gate semantics) live here |
| facebook-connect | supporting | OAuth mechanics, no differentiating logic |
| facebook-provider | supporting | Graph adapter; complexity is API mechanics |
| facebook-webhooks | supporting | Event parsing with strict filters |
| dual-channel-ui | supporting | Presentation of platform capability differences |
| validation-rollout | supporting | Config, docs, live verification |

### Candidate patterns (non-binding, per the required form)

- `Strategy — because send/read/refresh semantics vary by platform behind one worker-facing
  contract; revisit at build (may collapse to a keyed object literal of two provider objects)`.
- `Adapter — because each provider normalizes a distinct Graph dialect (reply edges, post listing,
  token lifecycle) to shared types; revisit at build (may collapse into the strategy
  implementations)`.
- No patterns for the schema, UI, or rollout epics — CRUD/plumbing per the Arbitration Rule.

## Risks & Gotchas

- **Feed webhook noise** — likes/shares/edits/statuses all fire `field:feed`; a soft filter fills
  the queue with garbage. Hard filter + exhaustive fixtures (E1) is the mitigation.
- **Migration drop/create trap** — Prisma's generated migration for a rename is drop+create; the
  SQL must be hand-written and verified on a copy (A2).
- **In-flight queue jobs across the payload rename** — drain at deploy (A3 note).
- **Follow gate silently no-oping on FB** — FR-5's three-layer enforcement (UI hide, API reject,
  worker warn) keeps the degradation visible.
- **Comments without `from`** (privacy-restricted FB users) — skipped by parser and reconciler;
  they cannot enter the pipeline that requires a commenter identity.
- **Page connected to two workspaces** — reuse the `canConnect` guard keyed on
  `[platform, externalId]`.
- **`/me/accounts` paging** — users managing many Pages need pagination in the picker (C2 handles
  the paged cursor).
- **Reconciler rate limits** — FB comment reads share the sweep caps (`MAX_NEW_PER_SWEEP`,
  `RECENT_MEDIA_LIMIT`); no new knobs.

## Non-Goals (v1)

- App Review / Advanced Access / Business Verification (explicitly avoided by design).
- Facebook Groups, ads/boosted-post comment indirection (`originalMediaId` stays IG-only),
  `attach-next-reel` for FB, follower-history backfill for FB, multi-Page bulk connect UX beyond
  the picker, generalizing `/api/instagram/*` URL paths.
- ZernFlow or any hosted third-party Meta proxy (evaluated and rejected in the feasibility note —
  no Meta integration exists in it to reuse).

## Sources

- `.claude-cliff-notes/2026-08-30_facebook-channel-feasibility.md` (capability map, App Review
  correction, ZernFlow rejection)
- `META_APP_REVIEW.md:1`, `docs/setup.md` Step 6 (tester escape hatch precedent)
- developers.facebook.com/docs/messenger-platform/discovery/private-replies
- developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages/
