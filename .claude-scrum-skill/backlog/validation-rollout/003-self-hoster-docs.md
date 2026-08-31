---
title: Self-hoster docs
epic: validation-rollout
slug: self-hoster-docs
status: backlog
executor: claude
priority: P1-high
points: 2
labels:
  - type:story
  - executor:claude
  - P1-high
  - epic:validation-rollout
  - ready-for-work
persona: impl
blocked_by: []
blocks: []
sprint: null
---

## Objective

Document the Facebook self-hoster path: app config, App Roles, scopes, no-review rationale.

## Acceptance Criteria

- [ ] `docs/setup.md` FB section (app config, App Roles, scopes, no-review rationale)
- [ ] `META_APP_REVIEW.md` FB paragraph; README channel matrix; `.env.example`
- [ ] Docs walk a fresh self-hoster to a connected Page without App Review

## Technical Context

N-7 Standard Access only. Mirror the existing IG tester-escape-hatch precedent in META_APP_REVIEW.md and docs/setup.md Step 6.

## Dependencies

- **Blocked by:** none
- **Blocks:** none
