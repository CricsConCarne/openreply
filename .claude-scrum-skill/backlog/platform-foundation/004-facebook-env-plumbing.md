---
title: Facebook env plumbing
epic: platform-foundation
slug: facebook-env-plumbing
status: backlog
executor: claude
priority: P1-high
points: 2
labels:
  - type:story
  - executor:claude
  - P1-high
  - epic:platform-foundation
  - ready-for-work
persona: impl
blocked_by: []
blocks: []
sprint: null
---

## Objective

Add FACEBOOK_APP_ID to the server env schema and a Facebook OAuth env preflight mirroring Instagram's.

## Acceptance Criteria

- [ ] `FACEBOOK_APP_ID` added to `serverEnvSchema` (FACEBOOK_APP_SECRET already required)
- [ ] `getMissingFacebookOAuthEnv` analog to the IG preflight
- [ ] `.env.example` / docs rows added
- [ ] Env tests cover the missing/present matrix mirroring the IG preflight

## Technical Context

A4 has no blockers and can run in parallel with A2/A3. FACEBOOK_APP_SECRET is already in serverEnvSchema. Mirror the existing IG env preflight helper.

## Dependencies

- **Blocked by:** none
- **Blocks:** none
