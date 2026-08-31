import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockDecryptToken,
  mockMatchKeywords,
  mockQueueAdd,
  mockResolveChannel,
  mockListPosts,
  mockGetRecentComments,
} = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn() },
    dmLog: { findMany: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  mockDecryptToken: vi.fn(),
  mockMatchKeywords: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockResolveChannel: vi.fn(),
  mockListPosts: vi.fn(),
  mockGetRecentComments: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/channels", () => ({
  resolveChannel: mockResolveChannel,
}));

vi.mock("@/lib/meta/client", () => ({
  MetaApiError: class MetaApiError extends Error {},
}));

vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecryptToken }));

vi.mock("@/lib/utils/keyword-matcher", () => ({
  matchKeywords: mockMatchKeywords,
}));

vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mockQueueAdd }),
}));

import { reconcileComments } from "@/lib/polling/comment-reconciler";
import type { ChannelComment } from "@/lib/channels/types";

const OWNER_ID = "owner1";

function automation(overrides: Record<string, unknown> = {}) {
  return {
    id: "auto1",
    name: "Campaign",
    postId: "media1",
    matchAnyPost: false,
    matchAnyWord: true,
    keywords: [],
    wholeWordMatch: false,
    publicReplyEnabled: false,
    workspaceId: "ws1",
    socialAccount: {
      id: "acct1",
      platform: "INSTAGRAM",
      externalId: OWNER_ID,
      username: "brand",
      accessToken: "encrypted",
    },
    ...overrides,
  };
}

function comment(overrides: Partial<ChannelComment>): ChannelComment {
  return {
    id: "c1",
    text: "love this",
    authorId: "fan1",
    authorName: "fan",
    timestamp: "2026-08-01T00:00:00Z",
    ownerReplied: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveChannel.mockReturnValue({
    listPosts: mockListPosts,
    getRecentComments: mockGetRecentComments,
  });
  mockDecryptToken.mockReturnValue("decrypted-token");
  mockMatchKeywords.mockReturnValue({ matched: true });
  mockPrisma.dmLog.findMany.mockResolvedValue([]);
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockQueueAdd.mockResolvedValue(undefined);
});

describe("reconcileComments — owner-replied outcomes", () => {
  it("skips a comment the provider marks ownerReplied and enqueues the rest", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([automation()]);
    mockGetRecentComments.mockResolvedValue([
      comment({ id: "answered", authorId: "fan1", ownerReplied: true }),
      comment({ id: "fresh", authorId: "fan2", ownerReplied: false }),
    ]);

    await reconcileComments();

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [, job] = mockQueueAdd.mock.calls[0];
    expect(job.commentId).toBe("fresh");
    expect(job.commenterId).toBe("fan2");
  });

  it("passes the account's externalId as ownerId so the provider derives ownerReplied", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([automation()]);
    mockGetRecentComments.mockResolvedValue([]);

    await reconcileComments();

    const [params] = mockGetRecentComments.mock.calls[0];
    expect(params.ownerId).toBe(OWNER_ID);
    expect(params.mediaId).toBe("media1");
    expect(params.accessToken).toBe("decrypted-token");
  });
});

describe("reconcileComments — consumes normalized ownerReplied, not raw edges", () => {
  it("enqueues when ownerReplied is false even if raw reply edges name the owner", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([automation()]);
    // A raw Graph reply edge from the owner is present, but the normalized flag
    // says false. The reconciler must trust the flag and enqueue.
    mockGetRecentComments.mockResolvedValue([
      {
        ...comment({ id: "trust-flag", authorId: "fan9", ownerReplied: false }),
        replies: { data: [{ id: "r1", from: { id: OWNER_ID } }] },
      } as ChannelComment,
    ]);

    await reconcileComments();

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd.mock.calls[0][1].commentId).toBe("trust-flag");
  });

  it("skips when ownerReplied is true even with no raw reply edges", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([automation()]);
    mockGetRecentComments.mockResolvedValue([
      comment({ id: "trust-true", authorId: "fan9", ownerReplied: true }),
    ]);

    await reconcileComments();

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

describe("reconcileComments — matchAnyPost uses provider.listPosts", () => {
  it("scans the recent posts returned by listPosts", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      automation({ postId: null, matchAnyPost: true }),
    ]);
    mockListPosts.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    mockGetRecentComments.mockResolvedValue([]);

    await reconcileComments();

    const [listParams] = mockListPosts.mock.calls[0];
    expect(listParams.accessToken).toBe("decrypted-token");
    expect(typeof listParams.max).toBe("number");
    expect(mockGetRecentComments).toHaveBeenCalledTimes(2);
  });
});
