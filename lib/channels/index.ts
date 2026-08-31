import { SocialPlatform } from "@/app/generated/prisma/client";
import type { ChannelProvider } from "@/lib/channels/types";
import { instagramProvider } from "@/lib/channels/instagram";
import { facebookProvider } from "@/lib/channels/facebook";

export * from "@/lib/channels/types";

// Register a provider per platform here.
const providers: Partial<Record<SocialPlatform, ChannelProvider>> = {
  [SocialPlatform.INSTAGRAM]: instagramProvider,
  [SocialPlatform.FACEBOOK]: facebookProvider,
};

/** Resolve the channel provider for a platform, or throw if none is registered. */
export function resolveChannel(platform: SocialPlatform): ChannelProvider {
  const provider = providers[platform];
  if (!provider) {
    throw new Error(`No channel provider registered for platform: ${platform}`);
  }
  return provider;
}
