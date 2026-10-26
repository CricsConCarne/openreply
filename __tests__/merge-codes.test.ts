import { describe, expect, it } from "vitest";
import {
  fillMergeCodes,
  postRef,
  UNKNOWN_POST_REF,
} from "../lib/tracking/merge-codes";

// dasreplay's attribution keeps utm_content only when it is a kebab slug of at
// most 64 characters; anything else is dropped without an error.
const KEBAB_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UTM_VALUE_MAX = 64;

const TEMPLATE =
  "https://dasreplay.com/pricing/?utm_source={platform}&utm_medium=dm&utm_campaign=ig-replay&utm_content={post}";

describe("postRef", () => {
  it("prefixes an Instagram media id", () => {
    expect(postRef("18045123456789012")).toBe("post-18045123456789012");
  });

  it("turns a Facebook pageId_postId into hyphens", () => {
    expect(postRef("1254914417707423_122110615071343079")).toBe(
      "post-1254914417707423-122110615071343079"
    );
  });

  it("lowercases and collapses any other characters", () => {
    expect(postRef("DQx7__AbC.")).toBe("post-dqx7-abc");
  });

  it("falls back to the unknown ref when nothing usable is left", () => {
    expect(postRef("___")).toBe(UNKNOWN_POST_REF);
  });

  it("stays a kebab slug within the length limit for an oversized id", () => {
    const ref = postRef(`${"1".repeat(40)}_${"2".repeat(40)}`);
    expect(ref).toMatch(KEBAB_SLUG);
    expect(ref.length).toBeLessThanOrEqual(UTM_VALUE_MAX);
  });
});

describe("fillMergeCodes", () => {
  it("returns a URL without codes unchanged", () => {
    const url = "https://dasreplay.com/pricing/?utm_source=instagram&utm_content=x";
    expect(fillMergeCodes(url, { platform: "INSTAGRAM", postId: "123" })).toBe(url);
  });

  it("fills platform and post", () => {
    expect(fillMergeCodes(TEMPLATE, { platform: "INSTAGRAM", postId: "123" })).toBe(
      "https://dasreplay.com/pricing/?utm_source=instagram&utm_medium=dm&utm_campaign=ig-replay&utm_content=post-123"
    );
  });

  it("names Facebook as facebook", () => {
    expect(fillMergeCodes("https://x.com/?s={platform}", { platform: "FACEBOOK" })).toBe(
      "https://x.com/?s=facebook"
    );
  });

  it("fills the unknown ref when there is no post", () => {
    expect(fillMergeCodes("https://x.com/?c={post}", { platform: "INSTAGRAM" })).toBe(
      "https://x.com/?c=post-unknown"
    );
  });

  it("fills every occurrence and percent-encoded codes", () => {
    expect(
      fillMergeCodes("https://x.com/{post}/?a={post}&b=%7Bpost%7D", {
        platform: "INSTAGRAM",
        postId: "9",
      })
    ).toBe("https://x.com/post-9/?a=post-9&b=post-9");
  });

  it("leaves codes it does not know", () => {
    expect(fillMergeCodes("https://x.com/?a={via}", { platform: "INSTAGRAM" })).toBe(
      "https://x.com/?a={via}"
    );
  });
});
