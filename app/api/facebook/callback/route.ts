import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canManageWorkspace } from "@/lib/workspace-access";
import {
  exchangeCodeForFacebookToken,
  exchangeForLongLivedUserToken,
  verifyOAuthState,
} from "@/lib/meta/facebook-oauth";
import { stashUserToken } from "@/lib/meta/facebook-connect-session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=invalid`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: state.workspaceId,
      userId: session.user.id,
    },
  });

  if (!membership || !canManageWorkspace(membership.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  try {
    const redirectUri = `${baseUrl}/api/facebook/callback`;
    const { accessToken: shortLivedToken } = await exchangeCodeForFacebookToken({
      code,
      redirectUri,
    });
    const { accessToken: longLivedToken } = await exchangeForLongLivedUserToken({
      shortLivedToken,
    });

    // The long-lived USER token is only needed until a Page is picked. Stash it
    // in an encrypted, short-lived cookie instead of the database — the Page
    // token is what we persist, once the user chooses which Page to connect.
    const response = NextResponse.redirect(
      `${baseUrl}/settings?facebook=select_page`
    );
    stashUserToken(response, longLivedToken);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Facebook Callback] Error:", err);
    // The message is the only diagnostic a self-hoster gets for a failed
    // connect, so persist it alongside the other operational events rather than
    // leaving it in server logs they may not be able to reach.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: state.workspaceId,
          message: "Facebook connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});

    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=failed&reason=${encodeURIComponent(
        message.slice(0, 200)
      )}`
    );
  }
}
