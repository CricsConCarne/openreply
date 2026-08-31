---
title: Cross-platform hardening fixtures
epic: validation-rollout
slug: cross-platform-hardening-fixtures
status: backlog
executor: claude
priority: P1-high
points: 3
labels:
  - type:story
  - executor:claude
  - P1-high
  - epic:validation-rollout
  - blocked
persona: impl
blocked_by: ["worker-on-the-seam", "facebook-messaging-sends", "facebook-feed-comment-parser"]
blocks: []
sprint: null
---

## Objective

Prove pipeline platform-neutrality by sweeping the shared machinery with FACEBOOK fixtures.

## Acceptance Criteria

- [ ] One test per machinery seam proving platform-neutrality: rate-limiter reservation, usage billing increment, ProcessedComment/DmLog dedup with `postid_commentid` ids, link tracking rows carrying `socialAccountId`
- [ ] FR-10 dedup holds: FB comment ids (`{postid}_{commentid}`) globally unique; `DmLog @@unique([automationId, commentId])`, ProcessedComment dedup set, deterministic BullMQ job ids (`comment_<externalId>_<commentId>` — no colons in FB ids) all hold unchanged

## Technical Context

G4 depends on B2, D1, E1. Sweep the shared machinery (lib/utils, lib/tracking, lib/billing) with FB fixtures.

## Dependencies

- **Blocked by:** channel-provider-seam/002-worker-on-the-seam, facebook-provider/001-facebook-messaging-sends, facebook-webhooks/001-facebook-feed-comment-parser
- **Blocks:** none
