/**
 * Facebook feed comment parser — Unit Tests
 *
 * The Facebook Page `feed` webhook is a firehose: it fires on likes, shares,
 * statuses, reactions, photos, edits, removes, and hides too. The parser must
 * emit ONLY freshly added comments (`item === "comment" && verb === "add"`).
 * This suite proves the hard filter drops every noise type exhaustively.
 */

import { describe, it, expect } from "vitest";
import { parseFacebookCommentEvents } from "../lib/meta/webhook";
import { SocialPlatform } from "@/app/generated/prisma/client";

type FeedValue = Record<string, unknown>;

function pagePayload(entryId: string, value: FeedValue) {
  return {
    object: "page",
    entry: [
      {
        id: entryId,
        time: 1234567890,
        changes: [{ field: "feed", value }],
      },
    ],
  };
}

function comment(overrides: FeedValue = {}): FeedValue {
  return {
    item: "comment",
    verb: "add",
    comment_id: "comment_456",
    post_id: "post_101",
    from: { id: "user_789", name: "Test User" },
    message: "I want the LINK!",
    ...overrides,
  };
}

describe("parseFacebookCommentEvents", () => {
  describe("hard noise filter (bugs cluster)", () => {
    const noisyItems = ["like", "share", "status", "reaction", "photo"];

    it.each(noisyItems)("drops item=%s (not a comment)", (item) => {
      const payload = pagePayload("page_123", comment({ item, verb: "add" }));
      expect(parseFacebookCommentEvents(payload)).toEqual([]);
    });

    const noisyVerbs = ["edit", "edited", "remove", "hide", "hidden"];

    it.each(noisyVerbs)("drops verb=%s (not an add)", (verb) => {
      const payload = pagePayload("page_123", comment({ verb }));
      expect(parseFacebookCommentEvents(payload)).toEqual([]);
    });

    it("drops a Page-authored comment (from.id === entry.id)", () => {
      const payload = pagePayload(
        "page_123",
        comment({ from: { id: "page_123", name: "The Page" } })
      );
      expect(parseFacebookCommentEvents(payload)).toEqual([]);
    });

    it("drops a comment missing from (privacy-restricted user)", () => {
      const value = comment();
      delete value.from;
      const payload = pagePayload("page_123", value);
      expect(parseFacebookCommentEvents(payload)).toEqual([]);
    });

    it("drops a comment whose from has no id", () => {
      const payload = pagePayload("page_123", comment({ from: { name: "No Id" } }));
      expect(parseFacebookCommentEvents(payload)).toEqual([]);
    });

    it("drops a comment missing comment_id", () => {
      const value = comment();
      delete value.comment_id;
      expect(parseFacebookCommentEvents(pagePayload("page_123", value))).toEqual([]);
    });

    it("drops a comment missing post_id", () => {
      const value = comment();
      delete value.post_id;
      expect(parseFacebookCommentEvents(pagePayload("page_123", value))).toEqual([]);
    });

    it("drops changes whose field is not feed", () => {
      const payload = {
        object: "page",
        entry: [
          {
            id: "page_123",
            time: 1,
            changes: [{ field: "mention", value: comment() }],
          },
        ],
      };
      expect(parseFacebookCommentEvents(payload)).toEqual([]);
    });

    it("returns [] when object is not page (e.g. instagram payload)", () => {
      const payload = { ...pagePayload("page_123", comment()), object: "instagram" };
      expect(parseFacebookCommentEvents(payload)).toEqual([]);
    });

    it("returns [] for an empty / entry-less payload", () => {
      expect(parseFacebookCommentEvents({ object: "page", entry: [] })).toEqual([]);
    });
  });

  describe("accept cases", () => {
    it("emits exactly one fully normalized event for item=comment verb=add", () => {
      const events = parseFacebookCommentEvents(pagePayload("page_123", comment()));

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        platform: SocialPlatform.FACEBOOK,
        externalAccountId: "page_123",
        commentId: "comment_456",
        commentText: "I want the LINK!",
        commenterId: "user_789",
        commenterName: "Test User",
        mediaId: "post_101",
        originalMediaId: undefined,
      });
    });

    it("leaves originalMediaId undefined (no ad indirection on FB v1)", () => {
      const events = parseFacebookCommentEvents(pagePayload("page_123", comment()));
      expect(events[0].originalMediaId).toBeUndefined();
    });

    it("defaults commentText to '' when message is absent", () => {
      const value = comment();
      delete value.message;
      const events = parseFacebookCommentEvents(pagePayload("page_123", value));
      expect(events[0].commentText).toBe("");
    });

    it("leaves commenterName undefined when from.name is absent", () => {
      const events = parseFacebookCommentEvents(
        pagePayload("page_123", comment({ from: { id: "user_789" } }))
      );
      expect(events[0].commenterName).toBeUndefined();
    });

    it("accumulates events across multiple entries and changes", () => {
      const payload = {
        object: "page",
        entry: [
          {
            id: "page_A",
            time: 1,
            changes: [
              { field: "feed", value: comment({ comment_id: "c1", from: { id: "u1", name: "One" } }) },
              // A noise change interleaved with a real one is dropped, not the whole entry.
              { field: "feed", value: comment({ item: "like", comment_id: "cX" }) },
              { field: "feed", value: comment({ comment_id: "c2", from: { id: "u2", name: "Two" } }) },
            ],
          },
          {
            id: "page_B",
            time: 2,
            changes: [
              { field: "feed", value: comment({ comment_id: "c3", post_id: "post_B", from: { id: "u3", name: "Three" } }) },
            ],
          },
        ],
      };

      const events = parseFacebookCommentEvents(payload);
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.commentId)).toEqual(["c1", "c2", "c3"]);
      expect(events.map((e) => e.externalAccountId)).toEqual(["page_A", "page_A", "page_B"]);
      expect(events.every((e) => e.platform === SocialPlatform.FACEBOOK)).toBe(true);
    });
  });
});
