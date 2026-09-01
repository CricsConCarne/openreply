/**
 * One-off Facebook lookback: DM the leads whose comments never got one.
 *
 * Enumerates comments on active Facebook campaigns inside Meta's private-reply
 * window and enqueues a DM for each unhandled keyword match, scheduled for the
 * same UTC time-of-day the comment was left — the recipient's original active
 * local hour, so the DM never lands in their night (see
 * lib/scheduling/lookback-window.ts). It only ENQUEUES; the running worker
 * delivers the jobs.
 *
 *   FB_LOOKBACK_CONFIRM=yes npm run fb:lookback
 *
 * Options (env vars):
 *   FB_LOOKBACK_WINDOW_DAYS    private-reply window in days (default 7)
 *   FB_LOOKBACK_MEDIA_LIMIT    recent posts to scan per any-post campaign
 *   FB_LOOKBACK_MAX_PER_SWEEP  comments enqueued per campaign
 *   FB_LOOKBACK_FINAL_DAY      "immediate" (default) | "skip" — what to do for a
 *                              lead whose only in-window time is off-hours
 *   FB_LOOKBACK_MARGIN_HOURS   margin before the window edge (default 2)
 *
 * Guarded by FB_LOOKBACK_CONFIRM=yes because it sends real DMs to real people.
 */

import { runLookback } from "@/lib/polling/comment-reconciler";
import type { LookbackOptions } from "@/lib/polling/comment-reconciler";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
import { prisma } from "@/lib/db/client";

function numberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}"`);
  }
  return value;
}

function readFinalDay(): LookbackOptions["finalDay"] {
  const raw = process.env.FB_LOOKBACK_FINAL_DAY;
  if (raw === undefined || raw === "") return undefined;
  if (raw !== "immediate" && raw !== "skip") {
    throw new Error(`FB_LOOKBACK_FINAL_DAY must be "immediate" or "skip", got "${raw}"`);
  }
  return raw;
}

function readOptions(): LookbackOptions {
  const marginHours = numberEnv("FB_LOOKBACK_MARGIN_HOURS");
  return {
    windowDays: numberEnv("FB_LOOKBACK_WINDOW_DAYS"),
    mediaLimit: numberEnv("FB_LOOKBACK_MEDIA_LIMIT"),
    maxPerSweep: numberEnv("FB_LOOKBACK_MAX_PER_SWEEP"),
    marginMs: marginHours === undefined ? undefined : marginHours * 60 * 60 * 1000,
    finalDay: readFinalDay(),
  };
}

async function main(): Promise<void> {
  if (process.env.FB_LOOKBACK_CONFIRM !== "yes") {
    throw new Error(
      "Refusing to run without FB_LOOKBACK_CONFIRM=yes — this enqueues real DMs to real leads."
    );
  }
  const options = readOptions();
  console.log("[FB Lookback] Enqueuing with", options);
  const summary = await runLookback(options);
  console.log("[FB Lookback] Done:", summary);
}

async function shutdown(): Promise<void> {
  await getDMQueue().close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  getRedisConnection().disconnect();
}

main()
  .then(shutdown)
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(
      "[FB Lookback] Failed:",
      error instanceof Error ? error.message : error
    );
    await shutdown();
    process.exit(1);
  });
