---
title: Platform-aware overview
epic: dual-channel-ui
slug: platform-aware-overview
status: backlog
executor: claude
priority: P2-medium
points: 2
labels:
  - type:story
  - executor:claude
  - P2-medium
  - epic:dual-channel-ui
  - blocked
persona: impl
blocked_by: ["codebase-rename-sweep", "facebook-fan-snapshots"]
blocks: []
sprint: null
---

## Objective

Render the fan-count series for FB accounts and degrade gracefully where FB lacks an IG metric.

## Acceptance Criteria

- [ ] Fan series labeled for FB in `components/follower-chart.tsx` / `app/(dashboard)/overview/page.tsx`
- [ ] Graceful "insights unavailable" states where FB lacks an IG metric
- [ ] Overview renders both account types without error

## Technical Context

F3 depends on A3 and D3 (fan snapshots). FR-8 follower chart from fan_count; no backfill.

## Dependencies

- **Blocked by:** platform-foundation/003-codebase-rename-sweep, facebook-provider/003-facebook-fan-snapshots
- **Blocks:** none
