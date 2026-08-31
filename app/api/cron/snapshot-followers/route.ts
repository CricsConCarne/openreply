import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { resolveChannel } from "@/lib/channels";
import {
  backfillFollowerHistory,
  recordFollowerSnapshot,
} from "@/lib/reports/follower-history";

/**
 * Records one follower total per connected account per day.
 *
 * Instagram retains only ~30 days of account insights, so this job is the only
 * source of longer-range follower history. Missing a run loses that day
 * permanently — there is no way to backfill beyond the insights window.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const accounts = await prisma.socialAccount.findMany({
    where: { accessToken: { not: "" } },
    select: {
      id: true,
      workspaceId: true,
      username: true,
      platform: true,
      externalId: true,
      accessToken: true,
    },
  });

  let recorded = 0;
  let backfilled = 0;
  const failures: Array<{ username: string; reason: string }> = [];

  for (const account of accounts) {
    try {
      const token = decryptToken(account.accessToken);
      const channel = resolveChannel(account.platform);
      const followerCount = await channel.getFollowerCount({
        accessToken: token,
        accountId: account.externalId,
      });

      if (followerCount === null) {
        failures.push({
          username: account.username,
          reason: "follower count not returned",
        });
        continue;
      }

      await recordFollowerSnapshot(account.id, followerCount);
      recorded += 1;

      // First time we see this account, try to recover the last 30 days —
      // only on platforms whose insights let us reconstruct that history.
      const existing = await prisma.followerSnapshot.count({
        where: { socialAccountId: account.id },
      });
      if (existing <= 1 && channel.hasFollowerHistoryBackfill) {
        backfilled += await backfillFollowerHistory(
          account.id,
          token,
          account.externalId,
          followerCount
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      failures.push({ username: account.username, reason });
      await prisma.operationalEvent
        .create({
          data: {
            source: "SYSTEM",
            level: "WARNING",
            workspaceId: account.workspaceId,
            message: "Follower snapshot failed",
            payload: { username: account.username, reason },
          },
        })
        .catch(() => {});
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      accounts: accounts.length,
      recorded,
      backfilled,
      failures,
    },
  });
}
