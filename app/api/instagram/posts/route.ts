import { NextRequest, NextResponse } from "next/server";
import { SocialPlatform } from "@/app/generated/prisma/client";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceSocialAccount } from "@/lib/social-accounts";
import { getAllUserMedia, getUserMedia } from "@/lib/meta/client";
import { resolveChannel } from "@/lib/channels";
import { decryptToken } from "@/lib/meta/oauth";

// Full-library ceiling for the campaign post picker, shared by both platforms.
const ALL_POSTS_MAX = 300;

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
        error: "Instagram account not connected. Please connect your account first.",
      },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);

    // `all=true` paginates the full library (for the campaign post picker);
    // otherwise return a single recent page.
    const loadAll = request.nextUrl.searchParams.get("all") === "true";

    // Facebook posts/reels come from the channel seam as normalized
    // ChannelPost values (id, caption, thumbnailUrl, permalink, timestamp).
    // Instagram keeps its richer path below unchanged.
    if (account.platform === SocialPlatform.FACEBOOK) {
      const posts = await resolveChannel(SocialPlatform.FACEBOOK).listPosts({
        accessToken,
        max: ALL_POSTS_MAX,
      });
      return NextResponse.json({ success: true, data: posts });
    }

    let posts;
    if (loadAll) {
      posts = await getAllUserMedia(accessToken, ALL_POSTS_MAX);
    } else {
      const limitParam = request.nextUrl.searchParams.get("limit");
      const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : 25;
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 50)
        : 25;
      posts = await getUserMedia(accessToken, limit);
    }

    return NextResponse.json({ success: true, data: posts });
  } catch (err) {
    console.error("[Instagram Posts] Error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch Instagram posts" },
      { status: 500 }
    );
  }
}
