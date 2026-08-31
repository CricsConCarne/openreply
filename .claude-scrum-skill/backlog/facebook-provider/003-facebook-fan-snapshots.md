---
title: Facebook fan-count snapshots
epic: facebook-provider
slug: facebook-fan-snapshots
status: backlog
executor: claude
priority: P2-medium
points: 2
labels:
  - type:story
  - executor:claude
  - P2-medium
  - epic:facebook-provider
  - persona:ops
  - blocked
persona: ops
blocked_by: ["channel-contract-and-instagram-provider"]
blocks: []
sprint: null
---

## Objective

Add a snapshot cron path that records Page fan_count into FollowerSnapshot for FB accounts.

## Acceptance Criteria

- [ ] Snapshot cron reads `GET /{page-id}?fields=fan_count` for FACEBOOK rows into `FollowerSnapshot`; no backfill
- [ ] Cron test writes one row per FB account per day; IG path untouched

## Technical Context

D3 depends on B1. FB has no 30-day follower_count insight to reconstruct from — no backfill (FR-8).

## Dependencies

- **Blocked by:** channel-provider-seam/001-channel-contract-and-instagram-provider
- **Blocks:** none
