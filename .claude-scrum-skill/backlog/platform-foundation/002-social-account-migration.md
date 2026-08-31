---
title: SocialAccount data-preserving migration
epic: platform-foundation
slug: social-account-migration
status: backlog
executor: claude
priority: P0-critical
points: 5
labels:
  - type:story
  - executor:claude
  - P0-critical
  - epic:platform-foundation
  - persona:ops
  - ready-for-work
persona: ops
blocked_by: []
blocks: []
sprint: null
---

## Objective

Rename InstagramAccount to SocialAccount with a platform enum via ONE hand-written data-preserving SQL migration.

## Acceptance Criteria

- [ ] Prisma schema updated per the delta: `enum SocialPlatform {INSTAGRAM, FACEBOOK}`; `model SocialAccount` (was InstagramAccount) with `platform SocialPlatform @default(INSTAGRAM)`, `externalId` (was instagramId), `tokenExpiresAt DateTime?`, `@@unique([platform, externalId])`
- [ ] FK renames on Automation, DmLog, LinkClick, FollowerSnapshot: `instagramAccountId` -> `socialAccountId`, relation `instagramAccount` -> `socialAccount`; `ProcessedComment.instagramAccountId` (bare string) -> `socialAccountId`
- [ ] ONE hand-written SQL migration using `ALTER TABLE "InstagramAccount" RENAME TO "SocialAccount"`, `RENAME COLUMN`, enum + platform column default INSTAGRAM, index/constraint renames, compound unique — never Prisma drop-and-recreate
- [ ] Verifiable offline now: `npx prisma validate` passes; `npm run db:generate` succeeds against the new schema; the hand-written `migration.sql` contains ONLY `ALTER/RENAME` statements (grep-assert: no `DROP TABLE "InstagramAccount"`, no `CREATE TABLE "SocialAccount"`)
- [ ] Deferred to staging (NO local Postgres in this environment — document as a manual/CI gate in the PR description, do NOT block the story on it): apply the migration to a seeded copy, assert row counts + FK integrity preserved, and that existing rows read back as `platform=INSTAGRAM`

## Technical Context

N-1 data-preserving migration. Prisma's generated migration for a rename is drop+create — the SQL MUST be hand-written (`prisma/migrations/<timestamp>_social_account/migration.sql`), never `prisma migrate dev`. Prisma 7, generated client at `app/generated/prisma`. Schema at `prisma/schema.prisma`.

**Environment note:** there is no Postgres reachable in this worktree, so data-preservation must be proven by SQL inspection + `prisma validate` + a green mocked test suite, with the live row-count assertion deferred to staging/CI (state that explicitly in the PR body). Run `npm run db:generate` before `npm run typecheck`/`npm test` — the generated client at `app/generated/prisma` is gitignored and absent in a fresh worktree.

## Dependencies

- **Blocked by:** none
- **Blocks:** none
