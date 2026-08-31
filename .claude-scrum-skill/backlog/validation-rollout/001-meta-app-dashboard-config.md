---
title: Meta app dashboard config
epic: validation-rollout
slug: meta-app-dashboard-config
status: backlog
executor: human
priority: P0-critical
points: 2
labels:
  - type:story
  - executor:human
  - P0-critical
  - epic:validation-rollout
  - persona:ops
  - ready-for-work
persona: ops
blocked_by: []
blocks: []
sprint: null
---

## Objective

Configure the existing Meta app for Facebook Login + Page webhooks and add the FB account under App Roles.

## Acceptance Criteria

- [ ] Add Facebook Login (for Business) product; set the callback redirect URI
- [ ] Subscribe the webhook product to the Page object with the existing callback URL + verify token
- [ ] Add the FB account under App Roles
- [ ] Webhook GET verification succeeds for the Page object; test event received

## Technical Context

executor:human — requires vendor-portal (Meta app dashboard) access Claude cannot reach. Uses the same App Roles escape hatch as the current IG tester setup (pages_messaging works under Standard Access).

## Dependencies

- **Blocked by:** none
- **Blocks:** none
