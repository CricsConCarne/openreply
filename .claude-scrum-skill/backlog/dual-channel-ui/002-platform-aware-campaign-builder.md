---
title: Platform-aware campaign builder
epic: dual-channel-ui
slug: platform-aware-campaign-builder
status: backlog
executor: claude
priority: P1-high
points: 5
labels:
  - type:story
  - executor:claude
  - P1-high
  - epic:dual-channel-ui
  - blocked
persona: impl
blocked_by: ["codebase-rename-sweep"]
blocks: []
sprint: null
---

## Objective

Make the campaign builder platform-aware: hide the FB follow-gate, reject requireFollow on FB, render FB posts/reels.

## Acceptance Criteria

- [ ] `components/account-select.tsx` badges; for a FACEBOOK account the follow-gate section is hidden with a one-line "Instagram-only" explainer
- [ ] Builder state resets `requireFollow` when switching to an FB account
- [ ] Automations API rejects `requireFollow=true` for FACEBOOK accounts
- [ ] Post picker renders FB posts/reels (`full_picture`/`message`); picker fixture renders both platforms

## Technical Context

F2 depends on A3. `components/campaign-builder.tsx` (1022 L). FR-5 three-layer enforcement (UI hide, API reject, worker warn) — this story is the UI-hide + API-reject layers.

## Dependencies

- **Blocked by:** platform-foundation/003-codebase-rename-sweep
- **Blocks:** none
