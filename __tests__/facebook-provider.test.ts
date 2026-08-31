import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSubscribeFacebookPageToWebhooks } = vi.hoisted(() => ({
  mockSubscribeFacebookPageToWebhooks: vi.fn(),
}));

vi.mock("@/lib/meta/facebook-oauth", () => ({
  subscribeFacebookPageToWebhooks: mockSubscribeFacebookPageToWebhooks,
}));

import { SocialPlatform } from "@/app/generated/prisma/client";
import { facebookProvider } from "@/lib/channels/facebook";
import { resolveChannel } from "@/lib/channels";
import {
  MetaApiError,
  PermissionError,
  RateLimitError,
  TokenExpiredError,
} from "@/lib/meta/client";

const GRAPH = "https://graph.facebook.com";
const SEND_RESULT = { recipient_id: "r1", message_id: "m1" };

beforeEach(() => {
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// Stub fetch with one JSON response, returning the mock so tests can inspect the
// request URL and body.
function stubFetchJson(payload: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    url: `${GRAPH}/v25.0/stub`,
    json: async () => payload,
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Stub fetch that returns each queued payload in turn (for pagination / merge).
function stubFetchSequence(pages: unknown[]) {
  const fetchMock = vi.fn();
  for (const payload of pages) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      url: `${GRAPH}/v25.0/stub`,
      json: async () => payload,
    } as Response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

describe("facebookProvider — identity", () => {
  it("is the Facebook platform with no follow gate", () => {
    expect(facebookProvider.platform).toBe(SocialPlatform.FACEBOOK);
    expect(facebookProvider.hasFollowGate).toBe(false);
  });
});

describe("facebookProvider — plain-text sends", () => {
  it("sendPrivateReply posts a comment_id recipient", async () => {
    const fetchMock = stubFetchJson(SEND_RESULT);
    const out = await facebookProvider.sendPrivateReply({
      accessToken: "tok",
      accountId: "page1",
      commentId: "c1",
      message: "hi",
    });

    expect(out).toEqual(SEND_RESULT);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v25.0/page1/messages");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
    expect(bodyOf(fetchMock)).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "hi" },
    });
  });

  it("sendDirectMessage posts an id recipient", async () => {
    const fetchMock = stubFetchJson(SEND_RESULT);
    await facebookProvider.sendDirectMessage({
      accessToken: "tok",
      accountId: "page1",
      userId: "u1",
      message: "yo",
    });
    expect(bodyOf(fetchMock)).toEqual({
      recipient: { id: "u1" },
      message: { text: "yo" },
    });
  });
});

describe("facebookProvider — postback button sends", () => {
  it("sendPrivateReplyWithButton truncates text to 640 and title to 20", async () => {
    const fetchMock = stubFetchJson(SEND_RESULT);
    await facebookProvider.sendPrivateReplyWithButton({
      accessToken: "tok",
      accountId: "page1",
      commentId: "c1",
      text: "x".repeat(700),
      buttonTitle: "T".repeat(30),
      payload: "PAYLOAD",
    });

    const payload = bodyOf(fetchMock).message.attachment.payload;
    expect(payload.template_type).toBe("button");
    expect(payload.text).toHaveLength(640);
    expect(payload.buttons).toEqual([
      { type: "postback", title: "T".repeat(20), payload: "PAYLOAD" },
    ]);
  });

  it("sendDirectMessageWithButton uses an id recipient", async () => {
    const fetchMock = stubFetchJson(SEND_RESULT);
    await facebookProvider.sendDirectMessageWithButton({
      accessToken: "tok",
      accountId: "page1",
      userId: "u1",
      text: "reveal",
      buttonTitle: "Tap",
      payload: "P",
    });
    expect(bodyOf(fetchMock).recipient).toEqual({ id: "u1" });
    expect(bodyOf(fetchMock).message.attachment.payload.buttons[0]).toEqual({
      type: "postback",
      title: "Tap",
      payload: "P",
    });
  });
});

describe("facebookProvider — link button sends", () => {
  it("caps at 3 web_url buttons and truncates each title to 20", async () => {
    const fetchMock = stubFetchJson(SEND_RESULT);
    await facebookProvider.sendPrivateReplyWithLinkButton({
      accessToken: "tok",
      accountId: "page1",
      commentId: "c1",
      text: "here",
      buttons: [
        { title: "A".repeat(25), url: "https://1.test" },
        { title: "B", url: "https://2.test" },
        { title: "C", url: "https://3.test" },
        { title: "D", url: "https://4.test" },
      ],
    });

    const buttons = bodyOf(fetchMock).message.attachment.payload.buttons;
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toEqual({
      type: "web_url",
      url: "https://1.test",
      title: "A".repeat(20),
    });
    expect(buttons.map((b: { url: string }) => b.url)).toEqual([
      "https://1.test",
      "https://2.test",
      "https://3.test",
    ]);
  });

  it("sendDirectMessageWithLinkButton uses an id recipient", async () => {
    const fetchMock = stubFetchJson(SEND_RESULT);
    await facebookProvider.sendDirectMessageWithLinkButton({
      accessToken: "tok",
      accountId: "page1",
      userId: "u1",
      text: "here",
      buttons: [{ title: "Open", url: "https://x.test" }],
    });
    expect(bodyOf(fetchMock).recipient).toEqual({ id: "u1" });
  });
});

describe("facebookProvider — error mapping", () => {
  it.each([
    [190, TokenExpiredError],
    [368, RateLimitError],
    [100, PermissionError],
    [1, MetaApiError],
  ])("maps Meta code %s to the right error class", async (code, ErrClass) => {
    stubFetchJson(
      { error: { message: "boom", type: "OAuthException", code } },
      false
    );

    await expect(
      facebookProvider.sendDirectMessage({
        accessToken: "tok",
        accountId: "page1",
        userId: "u1",
        message: "hi",
      })
    ).rejects.toBeInstanceOf(ErrClass);
  });
});

describe("facebookProvider — replyToComment", () => {
  it("posts to the comment's comments edge and returns void", async () => {
    const fetchMock = stubFetchJson({ id: "reply1" });
    const out = await facebookProvider.replyToComment({
      accessToken: "tok",
      commentId: "c1",
      message: "thanks",
    });

    expect(out).toBeUndefined();
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(
      "/v25.0/c1/comments"
    );
    expect(bodyOf(fetchMock)).toEqual({ message: "thanks" });
  });
});

describe("facebookProvider — getRecentComments", () => {
  function comment(over: Record<string, unknown>) {
    return {
      id: "c",
      message: "hello",
      from: { id: "author", name: "Fan" },
      created_time: "2026-08-10T00:00:00+0000",
      ...over,
    };
  }

  it("normalizes, skips from-less comments, and derives ownerReplied", async () => {
    const fetchMock = stubFetchSequence([
      {
        data: [
          comment({
            id: "c1",
            from: { id: "author1", name: "Fan1" },
            comments: { data: [{ from: { id: "page1" } }] },
          }),
          comment({
            id: "c2",
            from: { id: "author2", name: "Fan2" },
            comments: { data: [{ from: { id: "someone-else" } }] },
          }),
          comment({ id: "c3", from: undefined }),
        ],
      },
    ]);

    const out = await facebookProvider.getRecentComments({
      accessToken: "tok",
      mediaId: "post1",
      sinceMs: Date.parse("2026-08-01T00:00:00Z"),
      ownerId: "page1",
    });

    expect(out).toEqual([
      {
        id: "c1",
        text: "hello",
        authorId: "author1",
        authorName: "Fan1",
        timestamp: "2026-08-10T00:00:00+0000",
        ownerReplied: true,
      },
      {
        id: "c2",
        text: "hello",
        authorId: "author2",
        authorName: "Fan2",
        timestamp: "2026-08-10T00:00:00+0000",
        ownerReplied: false,
      },
    ]);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v25.0/post1/comments");
    expect(url.searchParams.get("fields")).toBe(
      "id,message,from{id,name},created_time,comments{from{id}}"
    );
    expect(url.searchParams.get("order")).toBe("reverse_chronological");
  });

  it("stops paginating once a page's oldest comment predates the lookback", async () => {
    const sinceMs = Date.parse("2026-08-05T00:00:00Z");
    const fetchMock = stubFetchSequence([
      {
        data: [
          comment({ id: "recent", created_time: "2026-08-10T00:00:00+0000" }),
          comment({ id: "stale", created_time: "2026-08-01T00:00:00+0000" }),
        ],
        paging: { next: `${GRAPH}/v25.0/post1/comments?after=CURSOR` },
      },
      { data: [comment({ id: "should-not-fetch" })] },
    ]);

    const out = await facebookProvider.getRecentComments({
      accessToken: "tok",
      mediaId: "post1",
      sinceMs,
      ownerId: "page1",
    });

    // Second page never fetched; the stale comment is filtered out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.map((c) => c.id)).toEqual(["recent"]);
  });
});

describe("facebookProvider — listPosts", () => {
  it("merges published posts and reels newest-first", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const isReels = String(input).includes("/video_reels");
      const payload = isReels
        ? {
            data: [
              {
                id: "reel1",
                description: "a reel",
                picture: "https://thumb.test/reel.jpg",
                created_time: "2026-08-15T00:00:00+0000",
                permalink_url: "https://fb.test/reel1",
              },
            ],
          }
        : {
            data: [
              {
                id: "post1",
                message: "a post",
                full_picture: "https://thumb.test/post.jpg",
                created_time: "2026-08-10T00:00:00+0000",
                permalink_url: "https://fb.test/post1",
              },
            ],
          };
      return Promise.resolve({
        ok: true,
        url: `${GRAPH}/v25.0/stub`,
        json: async () => payload,
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await facebookProvider.listPosts({ accessToken: "tok" });

    expect(out).toEqual([
      {
        id: "reel1",
        caption: "a reel",
        thumbnailUrl: "https://thumb.test/reel.jpg",
        timestamp: "2026-08-15T00:00:00+0000",
        permalink: "https://fb.test/reel1",
      },
      {
        id: "post1",
        caption: "a post",
        thumbnailUrl: "https://thumb.test/post.jpg",
        timestamp: "2026-08-10T00:00:00+0000",
        permalink: "https://fb.test/post1",
      },
    ]);
  });
});

describe("facebookProvider — getConversations", () => {
  it("normalizes participants and a one-message preview", async () => {
    stubFetchJson({
      data: [
        {
          id: "conv1",
          updated_time: "2026-08-10T00:00:00+0000",
          participants: {
            data: [
              { id: "u1", name: "Fan" },
              { id: "page1", name: "Brand" },
            ],
          },
          messages: {
            data: [
              {
                id: "msg1",
                message: "hello",
                from: { id: "u1", name: "Fan" },
                created_time: "2026-08-10T00:00:00+0000",
              },
            ],
          },
        },
        { id: "conv2" },
      ],
    });

    const out = await facebookProvider.getConversations({
      accessToken: "tok",
      accountId: "page1",
    });

    expect(out).toEqual([
      {
        id: "conv1",
        updatedTime: "2026-08-10T00:00:00+0000",
        participants: [
          { id: "u1", username: "Fan" },
          { id: "page1", username: "Brand" },
        ],
        lastMessage: {
          id: "msg1",
          text: "hello",
          from: { id: "u1", username: "Fan" },
          createdTime: "2026-08-10T00:00:00+0000",
        },
      },
      {
        id: "conv2",
        updatedTime: undefined,
        participants: [],
        lastMessage: undefined,
      },
    ]);
  });
});

describe("facebookProvider — subscribeWebhooks", () => {
  it("delegates to subscribeFacebookPageToWebhooks(pageId, token)", async () => {
    mockSubscribeFacebookPageToWebhooks.mockResolvedValue({ success: true });
    const out = await facebookProvider.subscribeWebhooks({
      accessToken: "tok",
      accountId: "page1",
    });
    expect(mockSubscribeFacebookPageToWebhooks).toHaveBeenCalledWith(
      "page1",
      "tok"
    );
    expect(out).toEqual({ success: true });
  });
});

describe("facebookProvider — no-op trivials", () => {
  it("getFollowStatus always resolves null (no follow gate)", async () => {
    await expect(
      facebookProvider.getFollowStatus({
        accessToken: "tok",
        recipientId: "u1",
      })
    ).resolves.toBeNull();
  });

  it("refreshToken always resolves null (page tokens never expire)", async () => {
    await expect(
      facebookProvider.refreshToken({ token: "old" })
    ).resolves.toBeNull();
  });
});

describe("facebookProvider — getFollowerCount", () => {
  it("GETs ?fields=fan_count with the page token and returns fan_count", async () => {
    const fetchMock = stubFetchJson({ fan_count: 9876, id: "page1" });
    const out = await facebookProvider.getFollowerCount({
      accessToken: "tok",
      accountId: "page1",
    });

    expect(out).toBe(9876);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v25.0/page1");
    expect(url.searchParams.get("fields")).toBe("fan_count");
    expect(url.searchParams.get("access_token")).toBe("tok");
  });

  it("returns null when fan_count is not a number", async () => {
    stubFetchJson({ id: "page1" });
    const out = await facebookProvider.getFollowerCount({
      accessToken: "tok",
      accountId: "page1",
    });
    expect(out).toBeNull();
  });

  it("has follower-history backfill disabled (FR-8)", () => {
    expect(facebookProvider.hasFollowerHistoryBackfill).toBe(false);
  });
});

describe("resolveChannel(FACEBOOK)", () => {
  it("returns the fully-implemented Facebook provider", () => {
    expect(resolveChannel(SocialPlatform.FACEBOOK)).toBe(facebookProvider);
  });
});
