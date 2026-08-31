---
title: Worker on the seam
epic: channel-provider-seam
slug: worker-on-the-seam
status: backlog
executor: claude
priority: P0-critical
points: 8
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:channel-provider-seam
  - blocked
persona: impl
blocked_by: ["channel-contract-and-instagram-provider"]
blocks: []
sprint: null
---

## Objective

Route all four worker processors + reveal DM through resolveChannel(job.platform); guard the follow-gate per FR-5.

## Acceptance Criteria

- [ ] All four processors (comment, postback, followup, message) + `sendRevealDirectMessage` resolve a provider from the job's `platform`
- [ ] Follow-gate flow guarded per FR-5: FB automations with `requireFollow=true` proceed without the gate and write an `OperationalEvent` WARNING (degrade visibly, never silently no-op)
- [ ] Zero platform conditionals in flow bodies (grep-asserted in a test or review checklist) — N-5 seam discipline
- [ ] Existing `dm-worker.test.ts` green unmodified except construction; new tests for platform resolution and the FB requireFollow warning path

## Technical Context

B2 depends on B1. `lib/queue/dm-worker.ts` (1294 L). Business rules stay in the worker; providers stay I/O-only. getFollowStatus returns null for FACEBOOK; caller treats null per existing IG semantics plus the FR-5 warning path.

## Dependencies

- **Blocked by:** channel-provider-seam/001-channel-contract-and-instagram-provider
- **Blocks:** none
