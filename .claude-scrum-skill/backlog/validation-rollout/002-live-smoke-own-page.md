---
title: Live smoke on own Page
epic: validation-rollout
slug: live-smoke-own-page
status: backlog
executor: human
priority: P0-critical
points: 3
labels:
  - type:story
  - executor:human
  - P0-critical
  - epic:validation-rollout
  - persona:ops
  - blocked
persona: ops
blocked_by: ["meta-app-dashboard-config"]
blocks: []
sprint: null
---

## Objective

End-to-end live validation on a real Page: comment->DM, reveal, DM trigger, logs/overview.

## Acceptance Criteria

- [ ] Connect the real Page; campaign on a real post
- [ ] A second (role-less, per A1 verdict) account comments -> private reply + public reply land; button tap reveals; DM keyword trigger replies; logs/overview populate
- [ ] Each leg screenshotted/logged in the cliff note

## Technical Context

executor:human — networked validation on the own Page under App Roles (the only networked test). Depends on G1.

## Dependencies

- **Blocked by:** validation-rollout/001-meta-app-dashboard-config
- **Blocks:** none
