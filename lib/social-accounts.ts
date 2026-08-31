import type { SocialPlatform } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";

export async function canConnectSocialAccount({
  workspaceId,
  externalId,
  platform = "INSTAGRAM",
}: {
  workspaceId: string;
  externalId: string;
  platform?: SocialPlatform;
}) {
  const existingAccount = await prisma.socialAccount.findUnique({
    where: { platform_externalId: { platform, externalId } },
    select: { workspaceId: true },
  });

  if (existingAccount && existingAccount.workspaceId !== workspaceId) {
    return {
      allowed: false,
      reason: "already_connected" as const,
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

export async function getWorkspaceSocialAccount(
  workspaceId: string,
  socialAccountId?: string | null
) {
  if (socialAccountId && socialAccountId !== "all") {
    return prisma.socialAccount.findFirst({
      where: { id: socialAccountId, workspaceId },
    });
  }

  return prisma.socialAccount.findFirst({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
  });
}
