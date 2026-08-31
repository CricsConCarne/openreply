---
title: Codebase rename sweep
epic: platform-foundation
slug: codebase-rename-sweep
status: backlog
executor: claude
priority: P0-critical
points: 5
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:platform-foundation
  - blocked
persona: impl
blocked_by: ["social-account-migration"]
blocks: []
sprint: null
---

## Objective

Sweep the ~41 source files from Instagram-specific identifiers to platform-neutral ones and regenerate the client.

## Acceptance Criteria

- [ ] Regenerate the Prisma client; sweep ~41 source files: `instagramAccount(Id)` -> `socialAccount(Id)`, `instagramId` -> `externalId`
- [ ] `lib/instagram-accounts.ts` -> `lib/social-accounts.ts` with `getWorkspaceSocialAccount`, `canConnectSocialAccount`
- [ ] Queue payloads (all four job interfaces in `lib/queue/client.ts`) -> `{platform, externalAccountId}`; shared route param `instagramAccountId` -> `socialAccountId`
- [ ] `tsc --noEmit`, eslint, and full vitest suite green; zero remaining references to old Prisma identifiers outside migrations
- [ ] Deploy note about draining in-flight Redis jobs recorded in the PR description

## Technical Context

A3 depends on A2. Job payloads carry the platform id (`entry.id`). In-flight Redis jobs written before deploy carry the old field name — drain the queue at deploy (self-hosted, own accounts; acceptable) rather than a compatibility shim. Route paths under `/api/instagram/*` KEEP their URLs; only the shared reads (posts, conversations, overview, accounts) become platform-aware and rename their query param.

## Dependencies

- **Blocked by:** platform-foundation/002-social-account-migration
- **Blocks:** none
