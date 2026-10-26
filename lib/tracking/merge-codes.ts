import type { SocialPlatform } from "@/app/generated/prisma/client";

/**
 * Merge codes in a tracked link's destination URL, filled at click time from
 * the post the commenter was on — so one evergreen campaign tags every reel's
 * traffic with that reel, without a campaign per post.
 *
 * The values land in UTM params that dasreplay's attribution keeps only when
 * they are kebab slugs of at most 64 characters; anything else is dropped
 * silently, so every ref this module makes is one.
 */

export interface MergeCodeContext {
  platform: SocialPlatform;
  postId?: string;
}

export const UNKNOWN_POST_REF = "post-unknown";

const POST_REF_PREFIX = "post-";
const UTM_VALUE_MAX = 64;
const NOT_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

const UTM_SOURCE_BY_PLATFORM: Record<SocialPlatform, string> = {
  INSTAGRAM: "instagram",
  FACEBOOK: "facebook",
};

// Each code in its literal and percent-encoded spelling: a URL that passed
// through `new URL()` has its path braces encoded.
const PLATFORM_CODE = /\{platform\}|%7Bplatform%7D/gi;
const POST_CODE = /\{post\}|%7Bpost%7D/gi;

export function fillMergeCodes(url: string, context: MergeCodeContext): string {
  return url
    .replace(PLATFORM_CODE, UTM_SOURCE_BY_PLATFORM[context.platform])
    .replace(POST_CODE, context.postId ? postRef(context.postId) : UNKNOWN_POST_REF);
}

/** `post-<id>` as a kebab slug; Facebook's `pageId_postId` becomes `pageId-postId`. */
export function postRef(postId: string): string {
  const slug = postId.toLowerCase().replace(NOT_SLUG_CHARACTERS, "-").replace(EDGE_HYPHENS, "");
  if (!slug) return UNKNOWN_POST_REF;
  const ref = `${POST_REF_PREFIX}${slug}`.slice(0, UTM_VALUE_MAX);
  return ref.replace(EDGE_HYPHENS, "");
}
