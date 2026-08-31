# Emulation Report — Facebook Channel

## Hardening Run 2 (post-fix re-validation) — CLEAN

**0 Critical · 0 Warning · 1 Info (deferred).** All Run 1 Critical and Warning findings are resolved on `release/hardening-run-1`. Suite green: tsc 0, lint 0, 277/277.

### Run 1 findings and their resolution

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| C1 | 🔴 Critical | `FACEBOOK_APP_ID` missing from `docker-compose.prod.yml` `x-app-env` allow-list → FB connect dead in prod (`requireEnv` throws) | ✅ FIXED — added `FACEBOOK_APP_ID: ${FACEBOOK_APP_ID:-}` (commit on release/hardening-run-1) |
| W1 | 🟡 Warning | `account-select.tsx` custom listbox lost keyboard/type-ahead/label a11y across 8 callers | ✅ FIXED — listbox role + `aria-activedescendant`/`aria-haspopup`/`aria-labelledby`, Arrow/Home/End/Enter/Escape + type-ahead; prop contract & all 8 callers untouched |
| I1 | 🔵 Info | `ProcessedComment` dead model + misleading `lib/queue/client.ts` comment claiming it backs dedup | ✅ FIXED comment (dedup = BullMQ job id + `DmLog @@unique`). Model left in schema (removal needs a migration; harmless, tracked) |
| I3 | 🔵 Info | Worker error/log strings hardcode "Instagram" on FB-shared paths (land in `DmLog.errorMessage`) | ✅ FIXED — 6 strings neutralized in `dm-worker.ts`; IG-only strings/enum/comments left intact |
| I4 | 🔵 Info | Overview account switcher didn't render a `PlatformBadge` | ✅ FIXED — `platform` added to the overview account map |
| I5 | 🔵 Info | `EMAIL_SERVER` also absent from the prod compose allow-list (same root cause as C1) | ✅ FIXED — added `EMAIL_SERVER: ${EMAIL_SERVER:-}` |

### Remaining (deferred, Info only)

| ID | Sev | Finding | Rationale for deferral |
|----|-----|---------|------------------------|
| I2 | 🔵 Info | FB `listPosts` fetches one page (~100 posts + 100 reels), no `paging.next`, vs IG's 500 (`lib/channels/facebook.ts`) | Post picker shows recent posts (≥200 is ample) and the reconciler works within its lookback window. Low value vs. effort; tracked for a future pass. Not a Critical/Warning. |

### Verified clean in Run 1 (no defect) — carried forward

- Queue/payload contracts end-to-end for all 4 job types (comment/message/postback/read), IG + FB, via `platform_externalId`.
- FB `object:page` messaging handled end-to-end through the seam; unknown webhook object → 200 (no Meta retry).
- FR-5 follow gate fail-closed at all 3 layers (UI hide + reset, API reject from DB platform, worker WARN); IG returns raw `null` on transient error (no regression).
- Negative cases: members 403'd on connect/disconnect/campaign mutations; `requireFollow=true` on FB rejected.
- Crons: refresh-tokens IG-only; snapshot-followers gates IG backfill on `hasFollowerHistoryBackfill`.
- Overview: FB `fan_count` labeled "page likes"; FB insights `null`, not zero. Health endpoint present; Dockerfile ships worker + generated Prisma.

**Zero Instagram regression** across every walked surface.

## Verdict

Phase 2 emulation-hardening reaches a clean state: no Critical, no Warning. Proceed to Phase 3 (project cleanup).
