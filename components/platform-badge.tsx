/**
 * Labeled pill identifying which social platform a row belongs to.
 * Presentational only; distinct color per platform carries the identity.
 */

import type { SocialPlatform } from "@/app/generated/prisma/client";

const platformConfig: Record<SocialPlatform, { label: string; className: string }> = {
  INSTAGRAM: { label: "Instagram", className: "bg-accent/10 text-accent" },
  FACEBOOK: { label: "Facebook", className: "bg-info/10 text-info" },
};

interface PlatformBadgeProps {
  platform: SocialPlatform;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  const config = platformConfig[platform];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
