<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Local build prerequisite

The Prisma client at `app/generated/prisma` is gitignored, so a fresh checkout or git worktree does not have it. After `npm ci` (or after cloning `node_modules` into a worktree), run `npm run db:generate` **before** `npm run typecheck` or `npm test` — otherwise `tsc` fails to resolve `app/generated/prisma`. There is no local Postgres/Redis in CI-less dev; the vitest suite mocks Prisma, so it runs offline. Migrations that need a live database are verified in staging/CI, not locally.
