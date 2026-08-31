# Orchestration State

## Meta
- **Repo:** openreply-facebook (local)
- **Project:** facebook-channel-v1
- **Phase:** epic-completion
- **Status:** running
- **Scope:** prd
- **PRD Source:** .claude-scrum-skill/specs/20260830_133037_facebook_channel.md
- **Scoped Epics:** platform-foundation, channel-provider-seam, facebook-connect, facebook-provider, facebook-webhooks, dual-channel-ui, validation-rollout
- **Scoped Stories:** 21 (18 claude / 2 human / 1 cowork), 75 pts
- **Started:** 2026-08-30T18:10:00Z
- **Last Updated:** 2026-08-30T18:25:00Z

## Current Position
- **Phase Started:** 2026-08-30T18:10:00Z
- **Current Epic:** facebook-provider
- **Current Sprint:** 4
- **Hardening Run:** 0
- **Merged to development:** platform-foundation (7a44322), channel-provider-seam (b89bb28), facebook-connect (b98f5cb)

## Execution Model (revised after Sprint 1)
- sprint_pipeline based the release branch on `main` (b1babea), NOT the current development HEAD, and exposes no base-branch arg. For DEPENDENT epics that would build against code Epic A already merged — unacceptable. `main` is human-only (never touch).
- Therefore: DIRECT controlled orchestration for epics B–G. Per epic: cut release/<slug> off development; subagent(s) implement in worktrees based on development (CoW node_modules + db:generate); subagent review; independent verification (tsc/lint/test + grep); merge story→release, review release, merge release→development.
- Parallelize within an epic where the DAG allows (e.g. B2+B3 after B1; D1/D2/D3; F1/F2/F3).

## Isolation Decision
- Worktree mode + CoW-clone of node_modules (APFS): probed green (worktree add + cp -c node_modules + prisma generate 295ms + tsc exit 0).
- Each story runs `npm run db:generate` before typecheck/test (documented in AGENTS.md, committed to development b36b073).
- No local Postgres/Redis: migration data-preservation deferred to staging/CI; vitest mocks Prisma (runs offline).
- Epic-at-a-time in dependency order; independent stories fan out within each epic's pipeline run.

## Epic Progress
| Epic | Status | Open | Closed | Total | Order |
|------|--------|------|--------|-------|-------|
| platform-foundation | CLOSED | 1 | 3 | 4 | 1 |
| channel-provider-seam (core) | CLOSED | 0 | 3 | 3 | 2 |
| facebook-connect | CLOSED | 0 | 2 | 2 | 3 |
| facebook-provider | in-progress | 3 | 0 | 3 | 4 |
| facebook-webhooks | pending | 2 | 0 | 2 | 5 |
| dual-channel-ui | pending | 3 | 0 | 3 | 6 |
| validation-rollout | pending | 4 | 0 | 4 | 7 |

## Current Sprint Stories (Sprint 1 — platform-foundation)
| Slug | Executor | Persona | Points | Status |
|------|----------|---------|--------|--------|
| standard-access-recipient-probe | cowork | research | 1 | skipped (human/cowork) — rollover |
| facebook-env-plumbing | claude | impl | 2 | DONE (50992a0, review: accept) — on release |
| social-account-migration + codebase-rename-sweep | claude | ops/impl | 10 | RECOVERING — merged into one atomic story |

## Sprint 4 (facebook-provider) progress
- D1+D2 combined facebook-graph-provider (8pt): DONE (2ce18f6) — full FB ChannelProvider (sends/comments/posts/conversations) + registered FACEBOOK + exported shared Graph helpers from client.ts and deduped facebook-oauth (Epic C follow-up). 224/224. Merged (ff).
- D3 facebook-fan-snapshots (2pt): DONE (318190a) — getFollowerCount seam method (IG followers_count / FB fan_count) + hasFollowerHistoryBackfill capability gates IG-only backfill; cron on the seam, no platform literal. 235/235. Merged (ff).
- Epic D release review: IN FLIGHT.

## Sprint 3 (facebook-connect) progress
- C1 facebook-oauth-module (3pt): DONE (dd8af9a) — dialog URL + token exchanges, reuses IG HMAC-state + AES-GCM, MetaApiError, v25.0. 191/191. Merged (ff).
- C2 page-connect-routes (5pt): DONE (38212ed) — 4 routes + encrypted 10-min transient-token cookie + /me/accounts paging + subscribed_apps; SocialAccount upsert tokenExpiresAt=null; canConnectSocialAccount generalized w/ platform param (default INSTAGRAM, backward-compat). 204/204. Merged (ff).
- Added connect Graph helpers getFacebookUserPages/subscribeFacebookPageToWebhooks (FB provider epic D will reuse).
- Epic C release review (security-focused): IN FLIGHT.

## Sprint 2 (channel-provider-seam) progress
- B1 channel-contract-and-instagram-provider: DONE (1b43fad) — contract + IG adapter, 18 tests, 171/171 green. Merged to release/channel-provider-seam (ff).
- B2 worker-on-the-seam (8pt): DONE (b3e9bb6) — 4 processors + reveal on the seam, FR-5 guard. Merged (no-ff 5308633).
- B3 reconciler-and-routes-on-the-seam (5pt): DONE (a7c1189) — reconciler uses normalized ownerReplied, conversations+cron on seam, cron excludes FB. Merged (ff).
- FIX 7e6d60d: B2 conflated getFollowStatus()===null ('no gate' vs IG 'transient error'), regressing IG to ungated. Added `hasFollowGate` capability → FR-5 only when no gate; IG null fail-closes as before. +IG-regression test. 182/182 green, tsc 0, lint 0.
- DEFERRED (tracked): posts + overview routes stay on lib/meta/client.ts directly (ChannelPost lacks media_type/media_url/insights) — migrate when the FB provider/UI epics (D2/F2/F3) grow the contract. IG-only today, behavior unchanged.
- Epic B release review: IN FLIGHT.

### Sprint 1 recovery note
- Pipeline run wf_a9c2e747: env-plumbing done; migration BLOCKED by review (relation rename `instagramAccount`→`socialAccount` changed API JSON shape; frontend pages still read `.instagramAccount` → runtime crash). rename-sweep cascaded blocked.
- Root cause: A2 (schema+migration) and A3 (call-site sweep) are NOT independently shippable — the relation rename ripples to frontend consumers; at a "story must work" gate they are ONE atomic change.
- Recovery: reused migration branch work (111f547: schema + pure ALTER/RENAME migration, prisma validate OK, backend FK sweep) on new branch `story/platform-foundation/atomic-rename`; subagent completing the frontend + payload + lib-file-rename sweep to green, then review + merge.
- Also: pipeline based release on old tip (b1babea), not development — rebased release/platform-foundation onto development (now includes AGENTS prereq note). Watch base-branch on later epics.

## Dependency Map
(from spec: B,C depend on A; D depends on B,C; E depends on B,D; F depends on A,C; G depends on all)

## Log
- [2026-08-30T18:10:00Z] Orchestration started — single-spec mode, local scaffolding
- [2026-08-30T18:10:00Z] Created development branch off facebook-channel-v1
- [2026-08-30T18:10:00Z] Started npm ci (deps absent)
- [2026-08-30T18:10:00Z] Scaffolding backlog from spec
