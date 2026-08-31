# ADR-0001: Multi-channel provider architecture (Instagram + Facebook)

- **Status:** Accepted
- **Date:** 2026-08-30
- **Context source:** `.claude-scrum-skill/specs/20260830_133037_facebook_channel.md`

## Context

OpenReply automated Instagram comment→DM funnels. Adding Facebook Pages as a
second channel risked scattering `if (platform === …)` branches through the
worker, reconciler, routes, and webhook layer. Facebook's messaging API is
shape-identical to Instagram's for every capability the product uses; the deltas
are concentrated (comment webhook shape, no follow gate, post listing, token
lifecycle). The pipeline (matcher, rate limiter, dedup, billing, tracking) is
platform-neutral.

## Decision

Resolve platform **once**, behind a provider seam, and never branch on it inside
flow bodies.

1. **One schema, one platform column.** `InstagramAccount` → `SocialAccount` with
   a `SocialPlatform` enum (`INSTAGRAM | FACEBOOK`), `instagramId` → `externalId`,
   and a compound `@@unique([platform, externalId])`. The rename was applied as a
   **single hand-written data-preserving SQL migration** (ALTER/RENAME only,
   never Prisma's drop-and-recreate), because every lookup is platform-scoped
   (the webhook `object` and job payload always name the platform).

2. **`ChannelProvider` seam.** `lib/channels/{types,instagram,facebook,index}`.
   One interface (send/reply/read-comments/list-posts/conversations/subscribe/
   follow-status/refresh/follower-count) with an Instagram implementation
   (a thin adapter delegating to the existing `lib/meta/client.ts`) and a
   Facebook implementation (new code against `graph.facebook.com`, sharing
   `handleResponse` + the `MetaApiError` family). `resolveChannel(platform)` is a
   plain keyed object literal — the Strategy/Adapter pattern collapsed to its
   simplest form per the engineering baseline's Arbitration Rule. Providers are
   **I/O-only**; business rules stay in the worker. Normalized value objects
   (`ChannelComment`, `ChannelPost`) mean no Graph shapes leak past the seam.

3. **Capabilities, not platform literals, express divergence.** Where behavior
   genuinely differs, the provider carries a static capability the caller reads,
   so no flow body inspects the platform:
   - `hasFollowGate` — false for Facebook. Load-bearing: it distinguishes
     "platform has no follow gate" (FR-5: degrade visibly — proceed ungated +
     WARNING) from Instagram's `getFollowStatus() === null` meaning "could not
     verify" (fail closed). Without this, Facebook's null would have silently
     regressed Instagram's transient-error handling.
   - `hasFollowerHistoryBackfill` — false for Facebook (no 30-day insight),
     gating the Instagram-only snapshot backfill.

4. **Webhook dispatch by `object`.** The route dispatches `"instagram"` vs
   `"page"` to the right comment parser; the `entry.messaging[]` parsers are
   shared (identical shape both platforms) and stamp `platform` onto each event,
   which then rides the job to the worker. A strict `item === "comment" &&
   verb === "add"` hard filter keeps Facebook's noisy `feed` events out of the
   queue.

## Consequences

- **Zero Instagram regression** was achievable and verified — Instagram runs the
  same code paths with identical values; the seam is additive.
- Adding a third channel is a new provider + a registry entry + a webhook-object
  case, not a codebase-wide sweep.
- The compound key and platform-stamped job payloads mean **in-flight Redis jobs
  must be drained at the deploy** that ships the payload rename (documented in
  the release notes) — the one non-backward-compatible edge.
- Route URLs under `/api/instagram/*` were kept for the Instagram-specific
  connect/disconnect endpoints (only the shared read routes became
  platform-aware) — a deliberate scope boundary to avoid churn.

## Alternatives rejected

- **Per-call `if (platform)` branching** — rejected: scatters platform knowledge,
  the exact failure mode the seam prevents (proven by the follow-gate conflation
  that a capability flag fixed).
- **A hosted third-party Meta proxy (ZernFlow)** — rejected in the feasibility
  note; no reusable Meta integration.
- **App Review / Advanced Access** — not required; own Pages run under Standard
  Access via App Roles (see `META_APP_REVIEW.md`).
