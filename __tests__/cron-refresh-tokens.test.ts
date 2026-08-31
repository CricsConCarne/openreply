import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialPlatform } from "@/app/generated/prisma/client";

const {
  mockPrisma,
  mockDecryptToken,
  mockEncryptToken,
  mockResolveChannel,
  mockRefreshToken,
} = vi.hoisted(() => ({
  mockPrisma: {
    workspace: { updateMany: vi.fn() },
    socialAccount: { findMany: vi.fn(), update: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  mockDecryptToken: vi.fn(),
  mockEncryptToken: vi.fn(),
  mockResolveChannel: vi.fn(),
  mockRefreshToken: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/channels", () => ({ resolveChannel: mockResolveChannel }));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: mockDecryptToken,
  encryptToken: mockEncryptToken,
}));

import { GET } from "../app/api/cron/refresh-tokens/route";
import type { NextRequest } from "next/server";

interface AccountRow {
  id: string;
  workspaceId: string;
  username: string;
  platform: SocialPlatform;
  accessToken: string;
  tokenExpiresAt: Date | null;
}

// The exact predicate the route's Prisma query encodes, applied in-memory so the
// test proves which rows the query would return.
function selectedBy(
  where: {
    platform?: SocialPlatform;
    accessToken?: { not?: string };
    tokenExpiresAt?: { not?: null; lte?: Date };
  },
  account: AccountRow
): boolean {
  if (where.platform && account.platform !== where.platform) return false;
  if (where.accessToken?.not !== undefined && account.accessToken === where.accessToken.not) {
    return false;
  }
  const expiry = where.tokenExpiresAt;
  if (expiry) {
    if (account.tokenExpiresAt === null) return false;
    if (expiry.lte && account.tokenExpiresAt > expiry.lte) return false;
  }
  return true;
}

const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);

const fixtures: AccountRow[] = [
  // Facebook, long-lived (null expiry) — the row the platform filter must exclude.
  {
    id: "fb-null",
    workspaceId: "ws1",
    username: "fbpage",
    platform: SocialPlatform.FACEBOOK,
    accessToken: "enc",
    tokenExpiresAt: null,
  },
  // Facebook that somehow carries an expiry — excluded by the platform filter,
  // NOT merely by the null-expiry predicate.
  {
    id: "fb-expiry",
    workspaceId: "ws1",
    username: "fbpage2",
    platform: SocialPlatform.FACEBOOK,
    accessToken: "enc",
    tokenExpiresAt: soon,
  },
  // Instagram inside the refresh window — the only row that should be processed.
  {
    id: "ig-soon",
    workspaceId: "ws1",
    username: "brand",
    platform: SocialPlatform.INSTAGRAM,
    accessToken: "enc",
    tokenExpiresAt: soon,
  },
  // Instagram whose token is far from expiry — excluded by the lte cutoff.
  {
    id: "ig-far",
    workspaceId: "ws1",
    username: "brand2",
    platform: SocialPlatform.INSTAGRAM,
    accessToken: "enc",
    tokenExpiresAt: farFuture,
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
  mockPrisma.workspace.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.socialAccount.update.mockResolvedValue({});
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockDecryptToken.mockReturnValue("plain");
  mockEncryptToken.mockReturnValue("enc-new");
  mockRefreshToken.mockResolvedValue({ accessToken: "new", expiresIn: 5184000 });
  mockResolveChannel.mockReturnValue({ refreshToken: mockRefreshToken });
  mockPrisma.socialAccount.findMany.mockImplementation(
    ({ where, select }: { where: never; select: Record<string, boolean> }) => {
      const rows = fixtures.filter((a) => selectedBy(where, a));
      return Promise.resolve(
        rows.map((a) =>
          Object.fromEntries(
            Object.keys(select).map((k) => [k, a[k as keyof AccountRow]])
          )
        )
      );
    }
  );
});

describe("GET /api/cron/refresh-tokens — Facebook rows are never selected", () => {
  it("filters on platform INSTAGRAM with a non-null expiry", async () => {
    await GET(authorizedRequest());

    const { where } = mockPrisma.socialAccount.findMany.mock.calls[0][0];
    expect(where.platform).toBe(SocialPlatform.INSTAGRAM);
    expect(where.tokenExpiresAt.not).toBeNull();
  });

  it("processes only the in-window Instagram account, excluding both Facebook rows", async () => {
    const response = await GET(authorizedRequest());
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data.totalProcessed).toBe(1);
    expect(body.data.results).toEqual([
      { socialAccountId: "ig-soon", username: "brand", status: "refreshed" },
    ]);

    // The Facebook account with a real expiry is excluded by the platform
    // filter, proving the filter — not just the null-expiry predicate — guards FB.
    const updatedIds = mockPrisma.socialAccount.update.mock.calls.map(
      (c) => c[0].where.id
    );
    expect(updatedIds).toEqual(["ig-soon"]);
    expect(updatedIds).not.toContain("fb-null");
    expect(updatedIds).not.toContain("fb-expiry");
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
