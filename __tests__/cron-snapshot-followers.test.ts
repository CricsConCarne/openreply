import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialPlatform } from "@/app/generated/prisma/client";

const {
  mockPrisma,
  mockDecryptToken,
  mockResolveChannel,
  mockRecordFollowerSnapshot,
  mockBackfillFollowerHistory,
  mockIgGetFollowerCount,
  mockFbGetFollowerCount,
} = vi.hoisted(() => ({
  mockPrisma: {
    socialAccount: { findMany: vi.fn() },
    followerSnapshot: { count: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  mockDecryptToken: vi.fn(),
  mockResolveChannel: vi.fn(),
  mockRecordFollowerSnapshot: vi.fn(),
  mockBackfillFollowerHistory: vi.fn(),
  mockIgGetFollowerCount: vi.fn(),
  mockFbGetFollowerCount: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/channels", () => ({ resolveChannel: mockResolveChannel }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: mockDecryptToken }));
vi.mock("@/lib/reports/follower-history", () => ({
  recordFollowerSnapshot: mockRecordFollowerSnapshot,
  backfillFollowerHistory: mockBackfillFollowerHistory,
}));

import { GET } from "../app/api/cron/snapshot-followers/route";
import type { NextRequest } from "next/server";

// The provider seam: an Instagram channel that backfills, a Facebook one that
// does not (FR-8). resolveChannel dispatches on platform.
const igChannel = {
  getFollowerCount: mockIgGetFollowerCount,
  hasFollowerHistoryBackfill: true,
};
const fbChannel = {
  getFollowerCount: mockFbGetFollowerCount,
  hasFollowerHistoryBackfill: false,
};

const accounts = [
  {
    id: "ig1",
    workspaceId: "ws1",
    username: "brand_ig",
    platform: SocialPlatform.INSTAGRAM,
    externalId: "ig-ext",
    accessToken: "enc-ig",
  },
  {
    id: "fb1",
    workspaceId: "ws1",
    username: "brand_fb",
    platform: SocialPlatform.FACEBOOK,
    externalId: "fb-ext",
    accessToken: "enc-fb",
  },
];

function authorizedRequest(): NextRequest {
  return {
    headers: { get: () => "Bearer test-secret" },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  mockPrisma.socialAccount.findMany.mockResolvedValue(accounts);
  mockPrisma.followerSnapshot.count.mockResolvedValue(1);
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockDecryptToken.mockImplementation((enc: string) => `plain-${enc}`);
  mockRecordFollowerSnapshot.mockResolvedValue(undefined);
  mockBackfillFollowerHistory.mockResolvedValue(5);
  mockIgGetFollowerCount.mockResolvedValue(4321);
  mockFbGetFollowerCount.mockResolvedValue(9876);
  mockResolveChannel.mockImplementation((platform: SocialPlatform) =>
    platform === SocialPlatform.FACEBOOK ? fbChannel : igChannel
  );
});

describe("GET /api/cron/snapshot-followers — records one snapshot per account", () => {
  it("records IG via followers_count and FB via fan_count", async () => {
    const response = await GET(authorizedRequest());
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data.recorded).toBe(2);

    expect(mockIgGetFollowerCount).toHaveBeenCalledWith({
      accessToken: "plain-enc-ig",
      accountId: "ig-ext",
    });
    expect(mockFbGetFollowerCount).toHaveBeenCalledWith({
      accessToken: "plain-enc-fb",
      accountId: "fb-ext",
    });

    expect(mockRecordFollowerSnapshot).toHaveBeenCalledTimes(2);
    expect(mockRecordFollowerSnapshot).toHaveBeenCalledWith("ig1", 4321);
    expect(mockRecordFollowerSnapshot).toHaveBeenCalledWith("fb1", 9876);
  });

  it("backfills history for the Instagram account only, never for Facebook", async () => {
    const body = await (await GET(authorizedRequest())).json();

    expect(mockBackfillFollowerHistory).toHaveBeenCalledTimes(1);
    expect(mockBackfillFollowerHistory).toHaveBeenCalledWith(
      "ig1",
      "plain-enc-ig",
      "ig-ext",
      4321
    );
    const backfilledIds = mockBackfillFollowerHistory.mock.calls.map((c) => c[0]);
    expect(backfilledIds).not.toContain("fb1");
    expect(body.data.backfilled).toBe(5);
  });

  it("records a failure (not a snapshot) when the count is unavailable", async () => {
    mockFbGetFollowerCount.mockResolvedValue(null);

    const body = await (await GET(authorizedRequest())).json();

    expect(body.data.recorded).toBe(1);
    expect(body.data.failures).toEqual([
      { username: "brand_fb", reason: "follower count not returned" },
    ]);
    expect(mockRecordFollowerSnapshot).toHaveBeenCalledTimes(1);
    expect(mockRecordFollowerSnapshot).toHaveBeenCalledWith("ig1", 4321);
  });

  it("logs an OperationalEvent and keeps going when a fetch throws", async () => {
    mockIgGetFollowerCount.mockRejectedValue(new Error("graph exploded"));

    const body = await (await GET(authorizedRequest())).json();

    expect(body.data.recorded).toBe(1);
    expect(body.data.failures).toEqual([
      { username: "brand_ig", reason: "graph exploded" },
    ]);
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledWith({
      data: {
        source: "SYSTEM",
        level: "WARNING",
        workspaceId: "ws1",
        message: "Follower snapshot failed",
        payload: { username: "brand_ig", reason: "graph exploded" },
      },
    });
    // The Facebook account still processed after the Instagram failure.
    expect(mockRecordFollowerSnapshot).toHaveBeenCalledWith("fb1", 9876);
  });

  it("rejects an unauthorized request before querying", async () => {
    const unauthorized = {
      headers: { get: () => "Bearer wrong" },
    } as unknown as NextRequest;

    const response = await GET(unauthorized);

    expect(response.status).toBe(401);
    expect(mockPrisma.socialAccount.findMany).not.toHaveBeenCalled();
  });
});
