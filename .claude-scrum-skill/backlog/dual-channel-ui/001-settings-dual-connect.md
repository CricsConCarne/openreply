---
title: Settings dual connect
epic: dual-channel-ui
slug: settings-dual-connect
status: backlog
executor: claude
priority: P1-high
points: 3
labels:
  - type:story
  - executor:claude
  - P1-high
  - epic:dual-channel-ui
  - blocked
persona: impl
blocked_by: ["page-connect-routes"]
blocks: []
sprint: null
---

## Objective

Add the Facebook connect button, Page-picker step, platform badges, and disconnect parity to settings.

## Acceptance Criteria

- [ ] Second connect button + Page-picker step in `app/(dashboard)/settings/page.tsx`
- [ ] Platform badges + per-platform status notices (`?facebook=` codes)
- [ ] Disconnect parity for FB accounts
- [ ] An FB account renders with badge, subscribe state, and a working disconnect

## Technical Context

F1 depends on C2. FR-9 platform visibility: every place an account is shown carries a platform badge.

## Dependencies

- **Blocked by:** facebook-connect/002-page-connect-routes
- **Blocks:** none
