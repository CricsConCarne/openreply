import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSendPrivateReply,
  mockSendPrivateReplyWithButton,
  mockSendPrivateReplyWithLinkButton,
  mockSendDirectMessage,
  mockSendDirectMessageWithButton,
  mockSendDirectMessageWithLinkButton,
  mockSendCommentReply,
  mockGetRecentMediaComments,
  mockGetAllUserMedia,
  mockGetConversations,
  mockSubscribeInstagramAccountToWebhooks,
  mockGetUserFollowStatus,
  mockGetUserInfo,
  mockRefreshLongLivedToken,
} = vi.hoisted(() => ({
  mockSendPrivateReply: vi.fn(),
  mockSendPrivateReplyWithButton: vi.fn(),
  mockSendPrivateReplyWithLinkButton: vi.fn(),
  mockSendDirectMessage: vi.fn(),
  mockSendDirectMessageWithButton: vi.fn(),
  mockSendDirectMessageWithLinkButton: vi.fn(),
  mockSendCommentReply: vi.fn(),
  mockGetRecentMediaComments: vi.fn(),
  mockGetAllUserMedia: vi.fn(),
  mockGetConversations: vi.fn(),
  mockSubscribeInstagramAccountToWebhooks: vi.fn(),
  mockGetUserFollowStatus: vi.fn(),
  mockGetUserInfo: vi.fn(),
  mockRefreshLongLivedToken: vi.fn(),
}));

vi.mock("@/lib/meta/client", () => ({
  sendPrivateReply: mockSendPrivateReply,
  sendPrivateReplyWithButton: mockSendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton: mockSendPrivateReplyWithLinkButton,
  sendDirectMessage: mockSendDirectMessage,
  sendDirectMessageWithButton: mockSendDirectMessageWithButton,
  sendDirectMessageWithLinkButton: mockSendDirectMessageWithLinkButton,
  sendCommentReply: mockSendCommentReply,
  getRecentMediaComments: mockGetRecentMediaComments,
  getAllUserMedia: mockGetAllUserMedia,
  getConversations: mockGetConversations,
  subscribeInstagramAccountToWebhooks: mockSubscribeInstagramAccountToWebhooks,
  getUserFollowStatus: mockGetUserFollowStatus,
  getUserInfo: mockGetUserInfo,
  refreshLongLivedToken: mockRefreshLongLivedToken,
}));

import { SocialPlatform } from "@/app/generated/prisma/client";
import { instagramProvider } from "@/lib/channels/instagram";
import { resolveChannel } from "@/lib/channels";
import type { ChannelProvider } from "@/lib/channels/types";

const provider: ChannelProvider = instagramProvider;
const sendResult = { recipient_id: "r1", message_id: "m1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("instagramProvider — message sends delegate positionally", () => {
  it("sendPrivateReply", async () => {
    mockSendPrivateReply.mockResolvedValue(sendResult);
    const out = await provider.sendPrivateReply({
      accessToken: "tok",
      accountId: "acct",
      commentId: "c1",
      message: "hi",
    });
    expect(mockSendPrivateReply).toHaveBeenCalledWith("tok", "acct", "c1", "hi");
    expect(out).toBe(sendResult);
  });

  it("sendPrivateReplyWithButton", async () => {
    mockSendPrivateReplyWithButton.mockResolvedValue(sendResult);
    await provider.sendPrivateReplyWithButton({
      accessToken: "tok",
      accountId: "acct",
      commentId: "c1",
      text: "body",
      buttonTitle: "Tap",
      payload: "PAYLOAD",
    });
    expect(mockSendPrivateReplyWithButton).toHaveBeenCalledWith(
      "tok",
      "acct",
      "c1",
      "body",
      "Tap",
      "PAYLOAD"
    );
  });

  it("sendPrivateReplyWithLinkButton", async () => {
    mockSendPrivateReplyWithLinkButton.mockResolvedValue(sendResult);
    const buttons = [{ title: "Open", url: "https://x.test" }];
    await provider.sendPrivateReplyWithLinkButton({
      accessToken: "tok",
      accountId: "acct",
      commentId: "c1",
      text: "body",
      buttons,
    });
    expect(mockSendPrivateReplyWithLinkButton).toHaveBeenCalledWith(
      "tok",
      "acct",
      "c1",
      "body",
      buttons
    );
  });

  it("sendDirectMessage", async () => {
    mockSendDirectMessage.mockResolvedValue(sendResult);
    await provider.sendDirectMessage({
      accessToken: "tok",
      accountId: "acct",
      userId: "u1",
      message: "hi",
    });
    expect(mockSendDirectMessage).toHaveBeenCalledWith("tok", "acct", "u1", "hi");
  });

  it("sendDirectMessageWithButton", async () => {
    mockSendDirectMessageWithButton.mockResolvedValue(sendResult);
    await provider.sendDirectMessageWithButton({
      accessToken: "tok",
      accountId: "acct",
      userId: "u1",
      text: "body",
      buttonTitle: "Tap",
      payload: "PAYLOAD",
    });
    expect(mockSendDirectMessageWithButton).toHaveBeenCalledWith(
      "tok",
      "acct",
      "u1",
      "body",
      "Tap",
      "PAYLOAD"
    );
  });

  it("sendDirectMessageWithLinkButton", async () => {
    mockSendDirectMessageWithLinkButton.mockResolvedValue(sendResult);
    const buttons = [{ title: "Open", url: "https://x.test" }];
    await provider.sendDirectMessageWithLinkButton({
      accessToken: "tok",
      accountId: "acct",
      userId: "u1",
      text: "body",
      buttons,
    });
    expect(mockSendDirectMessageWithLinkButton).toHaveBeenCalledWith(
      "tok",
      "acct",
      "u1",
      "body",
      buttons
    );
  });
});

describe("instagramProvider — replyToComment", () => {
  it("delegates to sendCommentReply and returns void", async () => {
    mockSendCommentReply.mockResolvedValue({ id: "reply1" });
    const out = await provider.replyToComment({
      accessToken: "tok",
      commentId: "c1",
      message: "thanks",
    });
    expect(mockSendCommentReply).toHaveBeenCalledWith("tok", "c1", "thanks");
    expect(out).toBeUndefined();
  });
});

describe("instagramProvider — getRecentComments normalization", () => {
  it("maps comments and derives ownerReplied from the owner's reply", async () => {
    mockGetRecentMediaComments.mockResolvedValue([
      {
        id: "c1",
        text: "love this",
        from: { id: "author1", username: "fan" },
        timestamp: "2026-08-01T00:00:00Z",
        replies: { data: [{ id: "r1", from: { id: "owner1" } }] },
      },
      {
        id: "c2",
        text: "me too",
        from: { id: "author2", username: "fan2" },
        timestamp: "2026-08-02T00:00:00Z",
        replies: { data: [{ id: "r2", from: { id: "someone-else" } }] },
      },
      {
        id: "c3",
        text: "no from",
        timestamp: "2026-08-03T00:00:00Z",
      },
    ]);

    const out = await provider.getRecentComments({
      accessToken: "tok",
      mediaId: "media1",
      sinceMs: 123,
      ownerId: "owner1",
      max: 50,
    });

    expect(mockGetRecentMediaComments).toHaveBeenCalledWith(
      "tok",
      "media1",
      123,
      50
    );
    expect(out).toEqual([
      {
        id: "c1",
        text: "love this",
        authorId: "author1",
        authorName: "fan",
        timestamp: "2026-08-01T00:00:00Z",
        ownerReplied: true,
      },
      {
        id: "c2",
        text: "me too",
        authorId: "author2",
        authorName: "fan2",
        timestamp: "2026-08-02T00:00:00Z",
        ownerReplied: false,
      },
      {
        id: "c3",
        text: "no from",
        authorId: "",
        authorName: undefined,
        timestamp: "2026-08-03T00:00:00Z",
        ownerReplied: false,
      },
    ]);
  });

  it("passes max through as undefined when omitted", async () => {
    mockGetRecentMediaComments.mockResolvedValue([]);
    await provider.getRecentComments({
      accessToken: "tok",
      mediaId: "media1",
      sinceMs: 5,
      ownerId: "owner1",
    });
    expect(mockGetRecentMediaComments).toHaveBeenCalledWith(
      "tok",
      "media1",
      5,
      undefined
    );
  });
});

describe("instagramProvider — listPosts normalization", () => {
  it("maps media to ChannelPost, falling back to media_url for thumbnail", async () => {
    mockGetAllUserMedia.mockResolvedValue([
      {
        id: "p1",
        caption: "a video",
        media_type: "VIDEO",
        thumbnail_url: "https://thumb.test/1.jpg",
        media_url: "https://media.test/1.mp4",
        timestamp: "2026-07-01T00:00:00Z",
        permalink: "https://ig.test/p1",
      },
      {
        id: "p2",
        media_type: "IMAGE",
        media_url: "https://media.test/2.jpg",
        timestamp: "2026-07-02T00:00:00Z",
      },
    ]);

    const out = await provider.listPosts({ accessToken: "tok", max: 10 });

    expect(mockGetAllUserMedia).toHaveBeenCalledWith("tok", 10);
    expect(out).toEqual([
      {
        id: "p1",
        caption: "a video",
        thumbnailUrl: "https://thumb.test/1.jpg",
        timestamp: "2026-07-01T00:00:00Z",
        permalink: "https://ig.test/p1",
      },
      {
        id: "p2",
        caption: undefined,
        thumbnailUrl: "https://media.test/2.jpg",
        timestamp: "2026-07-02T00:00:00Z",
        permalink: undefined,
      },
    ]);
  });
});

describe("instagramProvider — getConversations normalization", () => {
  it("maps participants and a one-message preview", async () => {
    mockGetConversations.mockResolvedValue([
      {
        id: "conv1",
        updated_time: "2026-08-10T00:00:00Z",
        participants: {
          data: [
            { id: "u1", username: "fan" },
            { id: "owner1", username: "brand" },
          ],
        },
        messages: {
          data: [
            {
              id: "msg1",
              message: "hello",
              from: { id: "u1", username: "fan" },
              created_time: "2026-08-10T00:00:00Z",
            },
          ],
        },
      },
      { id: "conv2" },
    ]);

    const out = await provider.getConversations({
      accessToken: "tok",
      accountId: "owner1",
    });

    expect(mockGetConversations).toHaveBeenCalledWith("tok", "owner1");
    expect(out).toEqual([
      {
        id: "conv1",
        updatedTime: "2026-08-10T00:00:00Z",
        participants: [
          { id: "u1", username: "fan" },
          { id: "owner1", username: "brand" },
        ],
        lastMessage: {
          id: "msg1",
          text: "hello",
          from: { id: "u1", username: "fan" },
          createdTime: "2026-08-10T00:00:00Z",
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

describe("instagramProvider — subscribeWebhooks", () => {
  it("delegates with accountId then accessToken", async () => {
    mockSubscribeInstagramAccountToWebhooks.mockResolvedValue({ success: true });
    const out = await provider.subscribeWebhooks({
      accessToken: "tok",
      accountId: "acct",
    });
    expect(mockSubscribeInstagramAccountToWebhooks).toHaveBeenCalledWith(
      "acct",
      "tok"
    );
    expect(out).toEqual({ success: true });
  });
});

describe("instagramProvider — getFollowStatus passes boolean|null through", () => {
  it.each([[true], [false], [null]])("returns %s unchanged", async (value) => {
    mockGetUserFollowStatus.mockResolvedValue(value);
    const out = await provider.getFollowStatus({
      accessToken: "tok",
      recipientId: "u1",
    });
    expect(mockGetUserFollowStatus).toHaveBeenCalledWith("tok", "u1");
    expect(out).toBe(value);
  });
});

describe("instagramProvider — refreshToken", () => {
  it("delegates to refreshLongLivedToken and returns its result", async () => {
    const refreshed = { accessToken: "new", expiresIn: 5184000 };
    mockRefreshLongLivedToken.mockResolvedValue(refreshed);
    const out = await provider.refreshToken({ token: "old" });
    expect(mockRefreshLongLivedToken).toHaveBeenCalledWith("old");
    expect(out).toBe(refreshed);
  });
});

describe("instagramProvider — getFollowerCount", () => {
  it("delegates to getUserInfo and returns followers_count", async () => {
    mockGetUserInfo.mockResolvedValue({ id: "1", username: "acct", followers_count: 4321 });
    const out = await provider.getFollowerCount({
      accessToken: "tok",
      accountId: "acct",
    });
    expect(mockGetUserInfo).toHaveBeenCalledWith("tok");
    expect(out).toBe(4321);
  });

  it("returns null when followers_count is not a number", async () => {
    mockGetUserInfo.mockResolvedValue({ id: "1", username: "acct" });
    const out = await provider.getFollowerCount({
      accessToken: "tok",
      accountId: "acct",
    });
    expect(out).toBeNull();
  });

  it("has follower-history backfill enabled", () => {
    expect(provider.hasFollowerHistoryBackfill).toBe(true);
  });
});

describe("resolveChannel", () => {
  it("returns the Instagram provider for INSTAGRAM", () => {
    expect(resolveChannel(SocialPlatform.INSTAGRAM)).toBe(instagramProvider);
  });

  it("throws for an unregistered platform", () => {
    expect(() =>
      resolveChannel("TIKTOK" as unknown as SocialPlatform)
    ).toThrow(/No channel provider registered/);
  });
});
