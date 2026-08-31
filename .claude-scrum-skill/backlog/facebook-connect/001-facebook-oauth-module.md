---
title: Facebook OAuth module
epic: facebook-connect
slug: facebook-oauth-module
status: backlog
executor: claude
priority: P0-critical
points: 3
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:facebook-connect
  - blocked
persona: impl
blocked_by: ["codebase-rename-sweep", "facebook-env-plumbing"]
blocks: []
sprint: null
---

## Objective

Build the FB OAuth module: dialog URL builder and the code->short->long-lived token exchanges, reusing existing crypto helpers.

## Acceptance Criteria

- [ ] `lib/meta/facebook-oauth.ts`: dialog URL builder with scopes `pages_show_list,pages_messaging,pages_read_engagement,pages_manage_engagement,pages_manage_metadata`
- [ ] code -> short user token; `grant_type=fb_exchange_token` -> long-lived user token (~60d) exchanges
- [ ] Reuses state HMAC (`createOAuthState`) + AES-GCM helpers
- [ ] Unit tests with mocked fetch for happy path, Meta error bodies, and state round-trip

## Technical Context

Supporting subdomain. Reuse the existing OAuth state HMAC and AES-GCM token crypto from `lib/meta/oauth.ts`. graph.facebook.com endpoints.

## Dependencies

- **Blocked by:** platform-foundation/003-codebase-rename-sweep, platform-foundation/004-facebook-env-plumbing
- **Blocks:** none
