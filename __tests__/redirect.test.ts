import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    trackedLink: {
      findUnique: vi.fn(),
    },
    linkClick: {
      create: vi.fn(),
    },
    dmLog: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

import { GET } from "../app/r/[slug]/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tracked link redirect route", () => {
  it("logs a workspace-isolated click and redirects to the destination", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_123",
      workspaceId: "workspace_123",
      automationId: "automation_123",
      destinationUrl: "https://example.com/offer",
      automation: {
        socialAccountId: "instagram_account_123",
        socialAccount: { platform: "INSTAGRAM" },
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await GET(
      new Request("https://manychat-alternative.com/r/abc123", {
        headers: {
          "user-agent": "vitest",
          referer: "https://instagram.com/",
          "x-forwarded-for": "203.0.113.10",
        },
      }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "abc123" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/offer");
    expect(mockPrisma.trackedLink.findUnique).toHaveBeenCalledWith({
      where: { slug: "abc123" },
      select: expect.any(Object),
    });
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_123",
        automationId: "automation_123",
        socialAccountId: "instagram_account_123",
        trackedLinkId: "link_123",
        userAgent: "vitest",
        referrer: "https://instagram.com/",
      }),
    });
  });

  // Cross-platform hardening: tracked-link attribution keys on the social
  // account row, never on platform. A tracked link for a Facebook automation
  // persists the click under the automation's socialAccountId — the same field
  // Instagram uses (app/r/[slug]/route.ts:34).
  it("persists a Facebook automation's socialAccountId on the click, same field as Instagram", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue({
      id: "link_fb_1",
      workspaceId: "workspace_fb_1",
      automationId: "automation_fb_1",
      destinationUrl: "https://example.com/fb-offer",
      automation: {
        socialAccountId: "facebook_page_account_9",
        socialAccount: { platform: "FACEBOOK" },
      },
    });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await GET(
      new Request("https://manychat-alternative.com/r/fbslug", {
        headers: {
          "user-agent": "vitest",
          referer: "https://facebook.com/",
          "x-forwarded-for": "198.51.100.7",
        },
      }) as Parameters<typeof GET>[0],
      { params: Promise.resolve({ slug: "fbslug" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://example.com/fb-offer"
    );
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "workspace_fb_1",
        automationId: "automation_fb_1",
        socialAccountId: "facebook_page_account_9",
        trackedLinkId: "link_fb_1",
      }),
    });
  });

  it("redirects unknown slugs to the homepage without logging a click", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(null);

    const response = await GET(
      new Request("https://manychat-alternative.com/r/missing") as Parameters<
        typeof GET
      >[0],
      { params: Promise.resolve({ slug: "missing" }) }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://manychat-alternative.com/");
    expect(mockPrisma.linkClick.create).not.toHaveBeenCalled();
  });
});

const TEMPLATE =
  "https://dasreplay.com/pricing/?utm_source={platform}&utm_medium=dm&utm_content={post}";

function linkWithDestination(destinationUrl: string, platform = "INSTAGRAM") {
  return {
    id: "link_1",
    workspaceId: "workspace_1",
    automationId: "automation_1",
    destinationUrl,
    automation: { socialAccountId: "account_1", socialAccount: { platform } },
  };
}

async function click(url: string) {
  return GET(new Request(url) as Parameters<typeof GET>[0], {
    params: Promise.resolve({ slug: "abc" }),
  });
}

describe("tracked link redirect with merge codes", () => {
  it("fills the post a DM was sent for and records it on the click", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(linkWithDestination(TEMPLATE));
    mockPrisma.dmLog.findFirst.mockResolvedValue({ id: "log_1" });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await click("https://reply.dasreplay.com/r/abc?p=1254_99");

    expect(response.headers.get("location")).toBe(
      "https://dasreplay.com/pricing/?utm_source=instagram&utm_medium=dm&utm_content=post-1254-99"
    );
    expect(mockPrisma.dmLog.findFirst).toHaveBeenCalledWith({
      where: { automationId: "automation_1", mediaId: "1254_99" },
      select: { id: true },
    });
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mediaId: "1254_99" }),
    });
  });

  it("treats a post this campaign never DMed for as unknown", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(linkWithDestination(TEMPLATE));
    mockPrisma.dmLog.findFirst.mockResolvedValue(null);
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await click("https://reply.dasreplay.com/r/abc?p=forged");

    expect(response.headers.get("location")).toContain("utm_content=post-unknown");
    expect(mockPrisma.linkClick.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ mediaId: expect.anything() }),
    });
  });

  it("fills unknown without a lookup when the link carries no post", async () => {
    mockPrisma.trackedLink.findUnique.mockResolvedValue(
      linkWithDestination(TEMPLATE, "FACEBOOK")
    );
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await click("https://reply.dasreplay.com/r/abc");

    expect(response.headers.get("location")).toBe(
      "https://dasreplay.com/pricing/?utm_source=facebook&utm_medium=dm&utm_content=post-unknown"
    );
    expect(mockPrisma.dmLog.findFirst).not.toHaveBeenCalled();
  });

  it("redirects a destination without codes byte-identically, post or not", async () => {
    const staticUrl = "https://dasreplay.com/pricing/?utm_source=instagram&utm_content=x";
    mockPrisma.trackedLink.findUnique.mockResolvedValue(linkWithDestination(staticUrl));
    mockPrisma.dmLog.findFirst.mockResolvedValue({ id: "log_1" });
    mockPrisma.linkClick.create.mockResolvedValue({});

    const response = await click("https://reply.dasreplay.com/r/abc?p=123");

    expect(response.headers.get("location")).toBe(staticUrl);
  });
});
