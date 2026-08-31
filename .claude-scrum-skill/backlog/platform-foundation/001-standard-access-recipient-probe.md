---
title: Standard-Access recipient probe
epic: platform-foundation
slug: standard-access-recipient-probe
status: backlog
executor: cowork
priority: P0-critical
points: 1
labels:
  - type:story
  - executor:cowork
  - P0-critical
  - epic:platform-foundation
  - persona:research
  - ready-for-work
persona: research
blocked_by: []
blocks: []
sprint: null
---

## Objective

Settle before coding whether Standard Access suffices on the recipient side, so the FB build proceeds on solid footing.

## Acceptance Criteria

- [ ] Run against production DB: `SELECT "commenterId","commenterName",status,"dmSentAt" FROM "DmLog" WHERE status='SENT' ORDER BY "dmSentAt" DESC LIMIT 20;`
- [ ] Verdict + evidence recorded in `.claude-cliff-notes/2026-08-30_facebook-channel-feasibility.md`
- [ ] Strangers present ⇒ Standard Access suffices ⇒ FB same. If testers-only, note the ceiling already exists on IG and FB does not worsen it (build proceeds either way).

## Technical Context

This is the settled-before-coding check from the feasibility note. Meta's Advanced Access rule governs the recipient and is identical for IG and FB. Record the verdict; build proceeds regardless.

## Dependencies

- **Blocked by:** none
- **Blocks:** none
