---
title: Facebook messaging sends
epic: facebook-provider
slug: facebook-messaging-sends
status: backlog
executor: claude
priority: P0-critical
points: 5
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

Implement the Facebook provider send methods against POST /{page-id}/messages with the existing error taxonomy.

## Acceptance Criteria

- [ ] `sendPrivateReply(+Button/+LinkButton)`, `sendDirectMessage(+Button/+LinkButton)` against `POST /{page-id}/messages` — `recipient:{comment_id}` or `{id}`; button/web_url payloads byte-identical to IG (text ≤640, title ≤20, ≤3 buttons)
- [ ] Meta error mapping through the existing `MetaApiError`/`TokenExpiredError`/`RateLimitError`/`PermissionError` taxonomy, sharing `handleResponse`
- [ ] Fixture tests per send variant incl. 640/20-char truncation and error mapping

## Technical Context

D1 depends on B1 (contract). New code against graph.facebook.com. Shares handleResponse and the MetaApiError family from `lib/meta/client.ts`.

## Dependencies

- **Blocked by:** channel-provider-seam/001-channel-contract-and-instagram-provider
- **Blocks:** none
