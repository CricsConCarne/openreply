---
title: Webhook dispatch + shared messaging
epic: facebook-webhooks
slug: webhook-dispatch-and-shared-messaging
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
blocked_by: ["facebook-feed-comment-parser", "worker-on-the-seam", "facebook-messaging-sends"]
blocks: []
sprint: null
---

## Objective

Dispatch the webhook route by object and generalize the messaging parsers to accept the page object.

## Acceptance Criteria

- [ ] `app/api/webhook/route.ts`: keep GET verification and signature check; dispatch POST by `payload.object` — "instagram" -> existing parsers; "page" -> `parseFacebookCommentEvents` + generalized messaging parsers
- [ ] messaging parsers (`parseMessageEvents`/`parsePostbackEvents`/`parseReadEvents`) replace the `object !== "instagram"` early-out with acceptance of `"instagram" | "page"`, threading the derived `platform`
- [ ] Account lookups move to `findUnique({ where: { platform_externalId } })`; job ids unchanged in shape (`comment_<externalId>_<commentId>`)
- [ ] End-to-end route tests enqueue the right jobs for object:page comment/message/postback/read payloads; object:instagram fixtures byte-identical behavior; unknown object -> 200 + recorded WebhookEvent

## Technical Context

E2 depends on E1 (parser), plus the seam (B2) and provider sends (D1). Signature verification already accepts both app secrets (N-4, unchanged).

## Dependencies

- **Blocked by:** facebook-webhooks/001-facebook-feed-comment-parser, channel-provider-seam/002-worker-on-the-seam, facebook-provider/001-facebook-messaging-sends
- **Blocks:** none
