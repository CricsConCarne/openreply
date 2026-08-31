# Facebook auto-DM + comment support in openreply — feasibility

Fork state: `origin` = CricsConCarne/openreply, `upstream` = diwenne/openreply, 5 commits ahead. Fork already exists; FB work is a branch.

## Verdict
Feasible. Pipeline ~80% reusable. **App Review is NOT required** for running your own Pages — see below. ~2 weeks eng, ship immediately.

## Current architecture (IG-only by construction)
- Instagram API with **Instagram Login** (`graph.instagram.com`), one long-lived token per account.
- 717 `instagram` refs across 78 files — mostly naming, not logic.

| Layer | File | FB reuse |
|---|---|---|
| OAuth | lib/meta/oauth.ts | rewrite |
| Graph calls | lib/meta/client.ts (774 L) | ~60% |
| Webhook parse | lib/meta/webhook.ts | new parsers |
| Webhook route | app/api/webhook/route.ts | mostly ok |
| Worker | lib/queue/dm-worker.ts (1294 L) | logic intact |
| Reconciler | lib/polling/comment-reconciler.ts | new fetch |
| keyword-matcher, rate-limiter, tracking, dedup, workspaces | lib/utils/*, lib/tracking/* | untouched |

## IG → FB capability map
| Capability | IG today | Facebook Page | Delta |
|---|---|---|---|
| Private reply to comment | POST graph.instagram.com/{ig-id}/messages, recipient:{comment_id} | POST graph.facebook.com/{page-id}/messages, same shape | identical |
| 7-day window, one message only | yes | yes | none |
| Button template + postback | yes | Messenger, richer | none |
| web_url buttons (<=3) | yes | yes | none |
| Public comment reply | /{comment-id}/replies | /{comment-id}/comments | path differs |
| Comment webhook | object:instagram, field:comments | object:page, field:feed, value.item=="comment" && verb=="add" | new parser + hard filter (feed fires on likes/shares/status) |
| DM / postback / read webhooks | entry.messaging[] | same entry.messaging[] shape | parser shared |
| Signature verify | already accepts IG **or** FB secret | — | already done |
| Reels | media_product_type | Meta treats Reels as posts; same feed webhook | covered |
| Follow gate (is_user_follow_business) | IG only | **no equivalent** | must disable per-channel |
| Follower chart | follower_count insights | fan_count / page_fans | separate impl |
| Post picker | /me/media | /{page-id}/published_posts + /{page-id}/video_reels | two calls |
| Token lifecycle | 60d + refresh cron | Page token from long-lived user token **never expires** | cron becomes IG-only |

## Plan
1. Schema (1 migration): `InstagramAccount`→`SocialAccount`, add `platform SocialPlatform @default(INSTAGRAM)`, `instagramId`→`externalId`; rename `instagramAccountId`→`socialAccountId` on Automation/DmLog/LinkClick/FollowerSnapshot/ProcessedComment. Gate `requireFollow` to INSTAGRAM.
2. Channel provider seam: `lib/channels/{types,instagram,facebook,index}.ts`. Interface = sendPrivateReply(+Button/+LinkButton), sendDirectMessage(+Button/+LinkButton), replyToComment, getRecentComments, listPosts, getConversations, subscribeWebhooks, getFollowStatus (null on FB), refreshToken (no-op on FB). Worker just resolves(platform) — no branching inside processComment.
3. FB auth: lib/meta/facebook-oauth.ts + app/api/facebook/{connect,callback,pages}. FB Login for Business dialog; scopes `pages_show_list, pages_messaging, pages_read_engagement, pages_manage_engagement, pages_manage_metadata`; code → short user token → fb_exchange_token → GET /me/accounts → **Page picker UI** → per-Page token. Add `FACEBOOK_APP_ID` env (FACEBOOK_APP_SECRET already present). Subscribe via POST /{page-id}/subscribed_apps fields `feed,messages,messaging_postbacks,message_reads`.
4. Webhook: drop `object !== "instagram"` gate, dispatch on object; add parseFacebookCommentEvents.
5. UI: platform badge, dual connect, hide follow-gate + follower chart for FB.

## App Review — CORRECTED (was wrongly called the long pole)
- Repo's own META_APP_REVIEW.md:1 — "You only need App Review if you want people who are not testers on your app to connect their own Instagram accounts. If you run OpenReply for your own accounts, skip this."
- Original openreply needed no review because the IG account was added as an **Instagram Tester** (docs/setup.md Step 6). Publishing the app != Advanced Access.
- **Same escape hatch on Facebook**: add FB account as Admin/Developer/Tester under App Roles, connect your own Page. `pages_messaging` works under Standard Access. No Business Verification.
- Meta rule verbatim: "Advanced Access is required to access conversations between your business and people who do **not** have a role on your messaging app, your Instagram Professional account, your Facebook Page, or your business."
- That governs the **recipient** (the stranger commenting) and is **identical for IG and FB**. Adding Facebook introduces no review requirement not already present on Instagram.
- Cheap test to settle it before coding:
  ```sql
  SELECT "commenterId","commenterName",status,"dmSentAt"
  FROM "DmLog" WHERE status='SENT' ORDER BY "dmSentAt" DESC LIMIT 20;
  ```
  Strangers in `commenterId` => Standard Access suffices on the recipient side => FB same. All testers => ceiling already exists on IG, FB doesn't worsen it.

## Effort
~2 weeks eng: seam/schema 4d, FB provider + OAuth 4d, webhook + reconciler 2d, UI 2d, tests 2d.

## Gotchas
- FB `feed` webhook is noisy (likes/shares/edits) — filter hard or the queue fills with garbage.
- Follow-gate has no FB analogue; must degrade visibly, not silently no-op.
- FB comment ids are `postid_commentid` — still unique, ProcessedComment dedup holds.

Sources: developers.facebook.com/docs/messenger-platform/discovery/private-replies; .../reference/webhook-events/messages/

## ZernFlow (github.com/zernio-dev/zernflow) — evaluated, REJECTED
Cloned + inspected 2026-08-30.
- `grep -rl "graph.facebook.com|graph.instagram.com" *.ts *.tsx` -> **ZERO matches**. No Meta integration exists in it.
- Everything routes through a hosted commercial service: `lib/zernio-client.ts` is 14 lines wrapping the `@zernio/node` SDK; webhooks land at `/api/webhooks/late`; `workspaces.late_api_key_encrypted`; channel connect at `/api/v1/channels/connect` uses **Zernio's** approved Meta app.
- README claims "bring your own Meta app credentials" — not reflected anywhere in the code.
- Stack mismatch: Supabase + React Flow vs openreply Prisma/Postgres/BullMQ/NextAuth.
- MIT license, so copying would be legal — there is simply nothing to copy.
- Trade would be: own your Meta app -> rent theirs; free -> recurring SaaS; DMs in your Postgres -> through a third party; vendor death = product death.
- **When it would be right:** only if App Review were required and Business Verification unpassable. Not our situation.

## Spec written 2026-08-30
- `.claude-scrum-skill/specs/20260830_133037_facebook_channel.md` (+ `.spec.json` sibling, SpecSchema-valid)
- 7 epics / 21 stories / 75 pts; branch `facebook-channel-v1`; single-pass scaffold, no design spike
- Epics: platform-foundation(13) → channel-provider-seam(18, core) → facebook-connect(8) / facebook-provider(10) / facebook-webhooks(6) → dual-channel-ui(10) → validation-rollout(10, incl. 2 human stories)
- Key decisions vs feasibility note: `@@unique([platform, externalId])` (not externalId alone); job payloads → `{platform, externalAccountId}` w/ queue drain at deploy; long-lived FB user token in encrypted 10-min cookie during Page pick; requireFollow triple-enforced (UI hide / API reject / worker WARN)
