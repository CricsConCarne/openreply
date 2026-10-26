import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { summarizeByPost } from "@/lib/tracking/analytics";

// Live counts for the campaign page; never cache.
export const dynamic = "force-dynamic";

/** GET ?id=<automationId> — DMs sent and clicks per post for one campaign. */
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const automation = await prisma.automation.findFirst({
    where: { id: request.nextUrl.searchParams.get("id") ?? "", workspaceId },
    select: { id: true },
  });
  if (!automation) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  const withPost = { automationId: automation.id, mediaId: { not: null } };
  const [dmRows, clickRows] = await Promise.all([
    prisma.dmLog.groupBy({
      by: ["mediaId"],
      where: { ...withPost, status: "SENT" },
      _count: { _all: true },
    }),
    prisma.linkClick.groupBy({ by: ["mediaId"], where: withPost, _count: { _all: true } }),
  ]);
  return NextResponse.json({ success: true, data: summarizeByPost(dmRows, clickRows) });
}
