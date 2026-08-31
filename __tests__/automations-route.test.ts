import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockContext } = vi.hoisted(() => ({
  mockPrisma: {
    workspace: { findUnique: vi.fn() },
    socialAccount: { findFirst: vi.fn() },
    automation: { create: vi.fn() },
  },
  mockContext: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
// Mock the auth module so importing the route doesn't pull next-auth (and its
// next/server import) into the vitest node env. POST resolves access through
// the workspace-access mock below, not this.
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { NextRequest } from "next/server";
import { POST } from "../app/api/automations/route";

const WORKSPACE = "workspace_1";
const ACCOUNT = "acct_1";

function postRequest(body: unknown) {
  return new NextRequest("https://app.example.com/api/automations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test campaign",
    socialAccountId: ACCOUNT,
    postId: "post_1",
    keywords: ["hi"],
    dmMessage: "hello {link}",
    ...overrides,
  };
}

function accountOn(platform: "INSTAGRAM" | "FACEBOOK") {
  mockPrisma.socialAccount.findFirst.mockResolvedValue({
    id: ACCOUNT,
    workspaceId: WORKSPACE,
    platform,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockContext.mockResolvedValue({
    userId: "user_1",
    workspaceId: WORKSPACE,
    role: "ADMIN",
  });
  mockPrisma.workspace.findUnique.mockResolvedValue({ id: WORKSPACE });
  mockPrisma.automation.create.mockResolvedValue({ id: "auto_1", trackedLinks: [] });
});

describe("POST /api/automations follow-gate platform guard", () => {
  it("rejects a follow gate on a Facebook account with a 400", async () => {
    accountOn("FACEBOOK");

    const response = await POST(postRequest(validPayload({ requireFollow: true })));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/facebook/i);
    expect(mockPrisma.automation.create).not.toHaveBeenCalled();
  });

  it("allows a follow gate on an Instagram account", async () => {
    accountOn("INSTAGRAM");

    const response = await POST(postRequest(validPayload({ requireFollow: true })));

    expect(response.status).toBe(201);
    expect(mockPrisma.automation.create).toHaveBeenCalledOnce();
  });

  it("allows a Facebook account when the follow gate is off", async () => {
    accountOn("FACEBOOK");

    const response = await POST(postRequest(validPayload({ requireFollow: false })));

    expect(response.status).toBe(201);
    expect(mockPrisma.automation.create).toHaveBeenCalledOnce();
  });
});
