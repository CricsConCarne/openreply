---
title: Channel contract + Instagram provider
epic: channel-provider-seam
slug: channel-contract-and-instagram-provider
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
blocked_by: ["codebase-rename-sweep"]
blocks: []
sprint: null
---

## Objective

Define the ChannelProvider contract and resolveChannel registry, with an Instagram provider that thinly delegates to the existing meta client.

## Acceptance Criteria

- [ ] `lib/channels/types.ts` contract (ChannelProvider interface per spec: sendPrivateReply(+Button/+LinkButton), sendDirectMessage(+Button/+LinkButton), replyToComment, getRecentComments, listPosts, getConversations, subscribeWebhooks, getFollowStatus, refreshToken)
- [ ] `resolveChannel(platform)` registry in `lib/channels/index.ts`
- [ ] Instagram provider (`lib/channels/instagram.ts`) delegates to existing `lib/meta/client.ts` functions — a thin adapter, no behavioral rewrite
- [ ] Contract unit-tested through the IG provider against mocked fetch; `getFollowStatus` and `refreshToken` behaviors preserved bit-for-bit
- [ ] No call-site changes yet (this story only adds the seam)

## Technical Context

Core subdomain. Params objects (>2 args everywhere) per the baseline. Normalized types ChannelComment/ChannelPost — no Graph shapes leak past the interface. Strategy/Adapter candidate patterns — keep as simple as a keyed object literal of two providers if that suffices (Arbitration Rule).

## Dependencies

- **Blocked by:** platform-foundation/003-codebase-rename-sweep
- **Blocks:** none
