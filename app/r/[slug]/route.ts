import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { fillMergeCodes } from "@/lib/tracking/merge-codes";
import { POST_PARAM } from "@/lib/tracking/message";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          socialAccountId: true,
          socialAccount: { select: { platform: true } },
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  const postId = await findVerifiedPostId(
    trackedLink.automationId,
    new URL(request.url).searchParams.get(POST_PARAM)
  );

  await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      socialAccountId: trackedLink.automation.socialAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
      ...(postId ? { mediaId: postId } : {}),
    },
  });

  const destination = fillMergeCodes(trackedLink.destinationUrl, {
    platform: trackedLink.automation.socialAccount.platform,
    postId,
  });
  return NextResponse.redirect(destination, { status: 302 });
}

/**
 * The link's post counts only if this campaign really DMed someone about it,
 * so a hand-edited `p` can't plant made-up posts in the analytics.
 */
async function findVerifiedPostId(
  automationId: string,
  postId: string | null
): Promise<string | undefined> {
  if (!postId) return undefined;
  const log = await prisma.dmLog.findFirst({
    where: { automationId, mediaId: postId },
    select: { id: true },
  });
  return log ? postId : undefined;
}
