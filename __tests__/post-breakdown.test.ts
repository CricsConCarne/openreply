import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeByPost } from "../lib/tracking/analytics";

const { mockPrisma, mockWorkspaceId } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findFirst: vi.fn() },
    dmLog: { groupBy: vi.fn() },
    linkClick: { groupBy: vi.fn() },
  },
  mockWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mockWorkspaceId }));

import { NextRequest } from "next/server";
import { GET } from "../app/api/automations/posts/route";

describe("summarizeByPost", () => {
  it("joins DMs and clicks per post, most DMs first, then most clicks", () => {
    expect(
      summarizeByPost(
        [
          { mediaId: "a", _count: { _all: 2 } },
          { mediaId: "b", _count: { _all: 5 } },
        ],
        [
          { mediaId: "a", _count: { _all: 1 } },
          { mediaId: "c", _count: { _all: 3 } },
        ]
      )
    ).toEqual([
      { mediaId: "b", ref: "post-b", dms: 5, clicks: 0 },
      { mediaId: "a", ref: "post-a", dms: 2, clicks: 1 },
      { mediaId: "c", ref: "post-c", dms: 0, clicks: 3 },
    ]);
  });

  it("ignores rows without a post", () => {
    expect(summarizeByPost([{ mediaId: null, _count: { _all: 9 } }], [])).toEqual([]);
  });
});

function getRequest(id: string) {
  return new NextRequest(`https://app.example.com/api/automations/posts?id=${id}`);
}

describe("GET /api/automations/posts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceId.mockResolvedValue("workspace_1");
    mockPrisma.dmLog.groupBy.mockResolvedValue([{ mediaId: "a", _count: { _all: 2 } }]);
    mockPrisma.linkClick.groupBy.mockResolvedValue([]);
  });

  it("rejects a signed-out request", async () => {
    mockWorkspaceId.mockResolvedValue(null);
    expect((await GET(getRequest("auto_1"))).status).toBe(401);
  });

  it("hides another workspace's campaign", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue(null);
    const response = await GET(getRequest("auto_1"));
    expect(response.status).toBe(404);
    expect(mockPrisma.automation.findFirst).toHaveBeenCalledWith({
      where: { id: "auto_1", workspaceId: "workspace_1" },
      select: { id: true },
    });
  });

  it("counts only sent DMs per post", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({ id: "auto_1" });
    const payload = await (await GET(getRequest("auto_1"))).json();
    expect(payload).toEqual({
      success: true,
      data: [{ mediaId: "a", ref: "post-a", dms: 2, clicks: 0 }],
    });
    expect(mockPrisma.dmLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { automationId: "auto_1", status: "SENT", mediaId: { not: null } },
      })
    );
  });
});
