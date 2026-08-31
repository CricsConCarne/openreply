---
title: Facebook comments + posts
epic: facebook-provider
slug: facebook-comments-and-posts
status: backlog
executor: claude
priority: P0-critical
points: 3
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:facebook-provider
  - blocked
persona: impl
blocked_by: ["channel-contract-and-instagram-provider"]
blocks: []
sprint: null
---

## Objective

Implement the Facebook provider read methods: comment reply, recent comments, post/reel listing, conversations.

## Acceptance Criteria

- [ ] `replyToComment` -> `POST /{comment-id}/comments {message}`
- [ ] `getRecentComments` -> `GET /{post-id}/comments?fields=id,message,from{id,name},created_time,comments{from{id}}` (paginate within lookback); nested `comments` edge normalized to `ownerReplied`
- [ ] `listPosts` -> `GET /{page-id}/published_posts` + `GET /{page-id}/video_reels` merged, sorted desc
- [ ] `getConversations` -> `GET /{page-id}/conversations?fields=participants,messages{…}`
- [ ] Fixture tests incl. comments missing `from`, pagination within lookback, reel/post merge order

## Technical Context

D2 depends on B1. Comments from privacy-restricted users lacking `from` are skipped (pipeline needs a commenter identity). No ad indirection on FB v1 (originalMediaId stays IG-only). map post_id -> mediaId.

## Dependencies

- **Blocked by:** channel-provider-seam/001-channel-contract-and-instagram-provider
- **Blocks:** none
