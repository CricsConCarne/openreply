---
title: Reconciler + routes on the seam
epic: channel-provider-seam
slug: reconciler-and-routes-on-the-seam
status: backlog
executor: claude
priority: P0-critical
points: 5
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:channel-provider-seam
  - blocked
persona: impl
blocked_by: ["channel-contract-and-instagram-provider"]
blocks: []
sprint: null
---

## Objective

Move the reconciler and shared read routes + token-refresh cron onto the provider seam.

## Acceptance Criteria

- [ ] Reconciler (`lib/polling/comment-reconciler.ts`) uses `provider.getRecentComments`/`listPosts` with normalized `ownerReplied`
- [ ] `posts`, `conversations`, `overview` routes go through the seam
- [ ] Token-refresh cron filters `platform: INSTAGRAM` (its query already requires non-null expiry — add the platform filter to make intent explicit)
- [ ] Reconciler tests cover both reply-edge shapes; cron test proves FB rows are never selected

## Technical Context

B3 depends on B1. getRecentComments normalizes the reply-edge difference (IG replies.data[].from.id vs FB nested comments.data[].from.id) into an ownerReplied boolean so the reconciler stays platform-neutral. No new sweep knobs.

## Dependencies

- **Blocked by:** channel-provider-seam/001-channel-contract-and-instagram-provider
- **Blocks:** none
