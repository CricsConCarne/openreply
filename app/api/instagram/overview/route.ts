import { NextRequest, NextResponse } from "next/server";
import type { SocialPlatform } from "@/app/generated/prisma/client";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getWorkspaceSocialAccount } from "@/lib/social-accounts";
import { resolveChannel } from "@/lib/channels";
import {
  getAllUserMedia,
  getMediaInsights,
  PermissionError,
  type InstagramMedia,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  ensureFollowerHistory,
  getFollowerHistory,
  recordFollowerSnapshot,
  type FollowerHistoryPoint,
} from "@/lib/reports/follower-history";

// Allow time for paginated media + per-post insight calls on larger accounts.
export const maxDuration = 60;

// Safety ceiling for "all time": bounds pagination and the number of
// per-media insight requests so we can't hammer the API or time out.
const MAX_POSTS = 500;

// How many insight requests to run at once.
const INSIGHTS_CONCURRENCY = 8;

/** Map over items with a bounded number of in-flight async operations. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export interface OverviewPost {
  id: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  timestamp: string;
  // Per-post insight metrics. null means the metric is unavailable for this
  // platform (Facebook exposes none of them through this route).
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
}

export interface OverviewResponse {
  account: { id: string; username: string; platform: SocialPlatform };
  accounts: Array<{ id: string; username: string; platform: SocialPlatform }>;
  requestedCount: "all" | number;
  truncated: boolean;
  insightsAvailable: boolean;
  /** Current follower total, or null if Instagram did not return it. */
  followers: number | null;
  /**
   * Follower total per day, ascending. Independent of the selected post range —
   * limited to what has been snapshotted plus any 30-day insights backfill.
   */
  followerHistory: FollowerHistoryPoint[];
  totals: {
    posts: number;
    views: number;
    reach: number;
    likes: number;
    comments: number;
    saved: number;
    shares: number;
    interactions: number;
  };
  posts: OverviewPost[];
}

function isVideoLike(media: InstagramMedia): boolean {
  return (
    media.media_product_type === "REELS" || media.media_type === "VIDEO"
  );
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const account = await getWorkspaceSocialAccount(
    workspaceId,
    request.nextUrl.searchParams.get("socialAccountId")
  );

  if (!account) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Instagram account not connected. Please connect your account first.",
      },
      { status: 400 }
    );
  }

  // Facebook Pages expose no per-post insights and no follower-count backfill
  // through this route, so they take a separate path that never touches the
  // Instagram Graph calls below. Instagram behaviour is left untouched.
  if (account.platform === "FACEBOOK") {
    return facebookOverview(request, workspaceId, account);
  }

  try {
    const accessToken = decryptToken(account.accessToken);

    const { requestedCount, target } = parseCountParam(request);

    const media = await getAllUserMedia(accessToken, target);
    const truncated = media.length >= MAX_POSTS;

    // Likes and comments come free with basic media fields. Views / reach /
    // saved / shares require the insights permission, so fetch them per media
    // (bounded concurrency) and degrade gracefully if the token was granted
    // before that scope.
    let insightsAvailable = false;
    let permissionDenied = false;

    const insights = await mapWithConcurrency(
      media,
      INSIGHTS_CONCURRENCY,
      async (m) => {
        const metrics = isVideoLike(m)
          ? ["views", "reach", "saved", "shares", "total_interactions"]
          : ["reach", "saved", "shares", "total_interactions"];
        try {
          const data = await getMediaInsights(accessToken, m.id, metrics);
          insightsAvailable = true;
          return data;
        } catch (err) {
          if (err instanceof PermissionError) permissionDenied = true;
          return null;
        }
      }
    );

    const posts: OverviewPost[] = media.map((m, i) => {
      const ins = insights[i];
      const likes = m.like_count ?? 0;
      const comments = m.comments_count ?? 0;
      return {
        id: m.id,
        caption: m.caption?.trim().slice(0, 120) ?? null,
        permalink: m.permalink ?? null,
        thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
        mediaType: m.media_product_type ?? m.media_type,
        timestamp: m.timestamp,
        views: ins?.views ?? null,
        reach: ins?.reach ?? null,
        likes,
        comments,
        saved: ins?.saved ?? null,
        shares: ins?.shares ?? null,
      };
    });

    const totals = posts.reduce(
      (acc, p) => {
        const likes = p.likes ?? 0;
        const comments = p.comments ?? 0;
        acc.posts += 1;
        acc.views += p.views ?? 0;
        acc.reach += p.reach ?? 0;
        acc.likes += likes;
        acc.comments += comments;
        acc.saved += p.saved ?? 0;
        acc.shares += p.shares ?? 0;
        acc.interactions += likes + comments + (p.saved ?? 0) + (p.shares ?? 0);
        return acc;
      },
      {
        posts: 0,
        views: 0,
        reach: 0,
        likes: 0,
        comments: 0,
        saved: 0,
        shares: 0,
        interactions: 0,
      }
    );

    const accounts = await listWorkspaceAccounts(workspaceId);

    // Followers is a point-in-time figure and deliberately not part of
    // `totals`, which sums over the selected posts. A failure here must not
    // take down the rest of the overview.
    let followers: number | null = null;
    let followerHistory: FollowerHistoryPoint[] = [];
    try {
      followers = await ensureFollowerHistory(
        { id: account.id, externalId: account.externalId },
        accessToken
      );
      followerHistory = await getFollowerHistory(account.id);
    } catch (err) {
      console.warn(
        "[Instagram Overview] Follower history unavailable:",
        err instanceof Error ? err.message : err
      );
    }

    const data: OverviewResponse = {
      account: {
        id: account.id,
        username: account.username,
        platform: account.platform,
      },
      accounts,
      requestedCount,
      truncated,
      insightsAvailable: insightsAvailable && !permissionDenied,
      followers,
      followerHistory,
      totals,
      posts,
    };

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Instagram Overview] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load Instagram overview" },
      { status: 500 }
    );
  }
}

/** Parse the `count` query param into a display value and a fetch ceiling. */
function parseCountParam(request: NextRequest): {
  requestedCount: "all" | number;
  target: number;
} {
  // `count` is either "all" or a positive integer (last N posts).
  const countParam = request.nextUrl.searchParams.get("count");
  const isAll = countParam === "all";
  const parsedCount = countParam ? Number.parseInt(countParam, 10) : NaN;
  const requestedCount: "all" | number = isAll
    ? "all"
    : Number.isFinite(parsedCount)
      ? Math.max(parsedCount, 1)
      : 50;

  const target = isAll
    ? MAX_POSTS
    : Math.min(requestedCount as number, MAX_POSTS);

  return { requestedCount, target };
}

function listWorkspaceAccounts(workspaceId: string) {
  return prisma.socialAccount.findMany({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
    select: { id: true, username: true, platform: true },
  });
}

const EMPTY_TOTALS: OverviewResponse["totals"] = {
  posts: 0,
  views: 0,
  reach: 0,
  likes: 0,
  comments: 0,
  saved: 0,
  shares: 0,
  interactions: 0,
};

interface OverviewAccount {
  id: string;
  username: string;
  externalId: string;
  accessToken: string;
  platform: SocialPlatform;
}

/**
 * Overview for a Facebook Page. The Page's follower series is its `fan_count`
 * (page likes), a different metric from Instagram followers — the client labels
 * it accordingly. Facebook exposes no per-post insights here, so metric fields
 * come back null (rendered as "unavailable") rather than a misleading zero.
 */
async function facebookOverview(
  request: NextRequest,
  workspaceId: string,
  account: OverviewAccount
): Promise<NextResponse> {
  try {
    const accessToken = decryptToken(account.accessToken);
    const { requestedCount, target } = parseCountParam(request);

    const facebook = resolveChannel("FACEBOOK");
    const channelPosts = await facebook.listPosts({
      accessToken,
      max: target,
    });
    const posts = channelPosts.slice(0, target).map(toFacebookOverviewPost);
    const truncated = channelPosts.length >= MAX_POSTS;

    const accounts = await listWorkspaceAccounts(workspaceId);
    const { followers, followerHistory } = await facebookFollowerSeries(
      facebook,
      accessToken,
      account
    );

    const data: OverviewResponse = {
      account: {
        id: account.id,
        username: account.username,
        platform: account.platform,
      },
      accounts,
      requestedCount,
      truncated,
      // No per-post insights on Facebook Pages via this route.
      insightsAvailable: false,
      followers,
      followerHistory,
      totals: { ...EMPTY_TOTALS, posts: posts.length },
      posts,
    };

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Facebook Overview] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to load Facebook overview" },
      { status: 500 }
    );
  }
}

/** Current fan count plus stored history; a failure degrades to nulls/empty. */
async function facebookFollowerSeries(
  facebook: ReturnType<typeof resolveChannel>,
  accessToken: string,
  account: OverviewAccount
): Promise<{ followers: number | null; followerHistory: FollowerHistoryPoint[] }> {
  try {
    const followers = await facebook.getFollowerCount({
      accessToken,
      accountId: account.externalId,
    });
    if (followers !== null) {
      await recordFollowerSnapshot(account.id, followers);
    }
    const followerHistory = await getFollowerHistory(account.id);
    return { followers, followerHistory };
  } catch (err) {
    console.warn(
      "[Facebook Overview] Follower history unavailable:",
      err instanceof Error ? err.message : err
    );
    return { followers: null, followerHistory: [] };
  }
}

function toFacebookOverviewPost(post: {
  id: string;
  caption?: string;
  permalink?: string;
  thumbnailUrl?: string;
  timestamp: string;
}): OverviewPost {
  return {
    id: post.id,
    caption: post.caption?.trim().slice(0, 120) ?? null,
    permalink: post.permalink ?? null,
    thumbnailUrl: post.thumbnailUrl ?? null,
    mediaType: "Facebook",
    timestamp: post.timestamp,
    views: null,
    reach: null,
    likes: null,
    comments: null,
    saved: null,
    shares: null,
  };
}
