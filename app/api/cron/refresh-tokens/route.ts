import { NextRequest, NextResponse } from "next/server";
import { SocialPlatform } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { resolveChannel } from "@/lib/channels";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";

const DAYS_BEFORE_EXPIRY = 10;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + DAYS_BEFORE_EXPIRY);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const usageReset = await prisma.workspace.updateMany({
    where: { usagePeriodStart: { lt: monthStart } },
    data: {
      usagePeriodStart: monthStart,
      dmsSentThisPeriod: 0,
    },
  });

  // Only Instagram tokens expire and need refreshing. Facebook page tokens are
  // long-lived with a null `tokenExpiresAt`, so the expiry predicate alone would
  // already exclude them — the explicit platform filter makes that intent
  // provable rather than incidental.
  const accountsToRefresh = await prisma.socialAccount.findMany({
    where: {
      platform: SocialPlatform.INSTAGRAM,
      accessToken: { not: "" },
      tokenExpiresAt: {
        not: null,
        lte: cutoffDate,
      },
    },
    select: {
      id: true,
      workspaceId: true,
      username: true,
      platform: true,
      accessToken: true,
    },
  });

  const results: Array<{
    socialAccountId: string;
    username: string;
    status: "refreshed" | "failed";
    error?: string;
  }> = [];

  for (const account of accountsToRefresh) {
    try {
      const currentToken = decryptToken(account.accessToken);
      const provider = resolveChannel(account.platform);
      const refreshed = await provider.refreshToken({ token: currentToken });
      // null = the platform has no token to refresh; the query only selects
      // Instagram, so this is a defensive no-op that never fires today.
      if (!refreshed) continue;
      const encryptedToken = encryptToken(refreshed.accessToken);
      const newExpiry = new Date(Date.now() + refreshed.expiresIn * 1000);

      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          accessToken: encryptedToken,
          tokenExpiresAt: newExpiry,
        },
      });

      results.push({
        socialAccountId: account.id,
        username: account.username,
        status: "refreshed",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await prisma.operationalEvent.create({
        data: {
          workspaceId: account.workspaceId,
          source: "TOKEN_REFRESH",
          level: "ERROR",
          message: `Token refresh failed for @${account.username}: ${errorMessage}`,
          payload: {
            socialAccountId: account.id,
            username: account.username,
          },
        },
      });

      results.push({
        socialAccountId: account.id,
        username: account.username,
        status: "failed",
        error: errorMessage,
      });
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      totalProcessed: accountsToRefresh.length,
      workspacesReset: usageReset.count,
      results,
    },
  });
}
