# Facebook Channel — Orchestration Notes (2026-08-30)

Driving `20260830_133037_facebook_channel.md` via /project-orchestrate (local, single-spec).
Backlog: 7 epics / 21 stories / 75 pts. Baseline oracle: typecheck clean, 149/149 vitest green.

## Environment facts
- npm project; `node_modules`, `app/generated/prisma`, `.env*` all gitignored.
- No local Postgres/Redis. vitest mocks Prisma → runs offline. Migration data-preservation
  (row counts on seeded copy) is a STAGING/CI gate, not verifiable locally.
- Worktree parallelism works: `git worktree add` + `cp -c -R node_modules` (APFS CoW) +
  `npm run db:generate` (regenerates gitignored client, ~300ms) → `tsc` green.
- Every fresh worktree MUST run `npm run db:generate` before typecheck/test (documented in
  AGENTS.md, dev commit b36b073).

## Decisions
- Design-spike epic SUPPRESSED: the spec already carries schema delta, provider-seam contract,
  subdomain classifications, and candidate patterns — a spike would duplicate it.
- Epic order (deps): platform-foundation → channel-provider-seam(core) → facebook-connect →
  facebook-provider → facebook-webhooks → dual-channel-ui → validation-rollout.

## Root-cause findings
- **A2+A3 are one atomic change, not two.** Renaming the Prisma relation
  `instagramAccount`→`socialAccount` changes the JSON shape API routes return; frontend pages
  read the old key → runtime crash. Review correctly BLOCKED the schema-only migration story.
  Fix: combine into `atomic-rename` (schema + migration + full backend+frontend+payload sweep).
- **sprint_pipeline based the release branch on the old tip (b1babea), not `development`.**
  Rebased release/platform-foundation onto development. Verify base on each later epic.

## Preserve-vs-rename ruleset (for the rename sweep)
- RENAME (internal): prisma.socialAccount, `.socialAccount` relation reads (incl. frontend),
  `instagramId`→`externalId` (Prisma col), FK/payload `instagramAccountId`→`socialAccountId`
  (payloads → `externalAccountId` + `platform`), lib/instagram-accounts.ts→lib/social-accounts.ts
  (getWorkspaceSocialAccount / canConnectSocialAccount), shared read route param → socialAccountId.
- PRESERVE (external): `/api/instagram/*` URLs, lib/meta/client.ts IG Graph internals + Meta
  wire field names, lib/meta/webhook.ts IG parser (object==="instagram"), INSTAGRAM_APP_* env vars.
