---
title: Facebook feed comment parser
epic: facebook-webhooks
slug: facebook-feed-comment-parser
status: backlog
executor: claude
priority: P0-critical
points: 3
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:facebook-webhooks
  - blocked
persona: impl
blocked_by: ["codebase-rename-sweep"]
blocks: []
sprint: null
---

## Objective

Write the strict feed-comment parser that admits only real new comments and drops all feed noise.

## Acceptance Criteria

- [ ] `parseFacebookCommentEvents`: `entry.changes[]` where `field === "feed"`; HARD filter `value.item === "comment" && value.verb === "add"`
- [ ] require `comment_id`, `post_id`, `from.id`; skip comments missing `from` (privacy-restricted); drop Page-authored comments (`from.id === entry.id`); map `post_id` -> `mediaId`
- [ ] Fixture tests prove drops for like/share/status/reaction/edit/remove events, Page-authored comments, and missing `from`
- [ ] Accepted events carry `{platform:FACEBOOK, externalAccountId, commentId, mediaId(post_id), commenter}`

## Technical Context

N-2 feed-noise immunity is the highest-risk correctness surface — test it exhaustively (bugs cluster). `lib/meta/webhook.ts`. No ad indirection (originalMediaId stays IG-only).

## Dependencies

- **Blocked by:** platform-foundation/003-codebase-rename-sweep
- **Blocks:** none
