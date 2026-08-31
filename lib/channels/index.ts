import { SocialPlatform } from "@/app/generated/prisma/client";
import type { ChannelProvider } from "@/lib/channels/types";
import { instagramProvider } from "@/lib/channels/instagram";

export * from "@/lib/channels/types";

// Register a provider per platform here. Facebook is added by a later story —
// add its entry alongside Instagram when its provider lands.
const providers: Partial<Record<SocialPlatform, ChannelProvider>> = {
  [SocialPlatform.INSTAGRAM]: instagramProvider,
};

/** Resolve the channel provider for a platform, or throw if none is registered. */
export function resolveChannel(platform: SocialPlatform): ChannelProvider {
  const provider = providers[platform];
  if (!provider) {
    throw new Error(`No channel provider registered for platform: ${platform}`);
  }
  return provider;
}
