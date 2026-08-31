---
title: Page connect routes
epic: facebook-connect
slug: page-connect-routes
status: backlog
executor: claude
priority: P0-critical
points: 5
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:facebook-connect
  - blocked
persona: impl
blocked_by: ["facebook-oauth-module"]
blocks: []
sprint: null
---

## Objective

Implement the four-step FB connect flow with an encrypted short-TTL cookie and the SocialAccount upsert + webhook subscribe.

## Acceptance Criteria

- [ ] `app/api/facebook/{connect,callback,pages}/route.ts`: connect (guards mirror IG: session, canManageWorkspace, env preflight) -> callback (verify state, exchanges, stash long-lived user token in an encrypted httpOnly cookie, 10-min TTL, never persisted) -> pages GET (`/me/accounts`, paged) -> pages POST (selected Page)
- [ ] pages POST: encrypt Page access_token (never expires) -> upsert `SocialAccount {platform:FACEBOOK, externalId:pageId, tokenExpiresAt:null}` with the `canConnect` cross-workspace guard keyed on `[platform, externalId]`
- [ ] `POST /{page-id}/subscribed_apps` with `subscribed_fields=feed,messages,messaging_postbacks,message_reads` (page token); `webhookSubscribed` reflects the subscribe result
- [ ] `?facebook=` redirect status codes mirroring the `?instagram=` pattern; cookie cleared after selection
- [ ] Route tests for guard/env/state failures; cookie never outlives selection; token stored encrypted with `tokenExpiresAt=null`

## Technical Context

C2 depends on C1. N-3 secrets: long-lived user token held only transiently (encrypted, short-TTL). `/me/accounts` paging handled for users managing many Pages. Mirror the IG `webhookSubscribed` handling.

## Dependencies

- **Blocked by:** facebook-connect/001-facebook-oauth-module
- **Blocks:** none
