import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAuth, mockContext } = vi.hoisted(() => ({
  mockPrisma: {
    workspaceMember: { findFirst: vi.fn() },
    socialAccount: { findUnique: vi.fn(), upsert: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  mockAuth: vi.fn(),
  mockContext: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { NextRequest } from "next/server";
import { GET as connect } from "../app/api/facebook/connect/route";
import { GET as callback } from "../app/api/facebook/callback/route";
import { GET as listPages, POST as connectPage } from "../app/api/facebook/pages/route";
import { createOAuthState, decryptToken, encryptToken } from "../lib/meta/facebook-oauth";

const BASE_URL = "https://app.example.com";
const WORKSPACE = "workspace_1";
const USER_TOKEN = "long-lived-user-token";
const COOKIE_NAME = "fb_connect_user_token";
const ENCRYPTION_KEY = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_URL", BASE_URL);
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv("FACEBOOK_APP_ID", "fb-app-id");
  vi.stubEnv("FACEBOOK_APP_SECRET", "fb-app-secret");
  vi.stubEnv("ENCRYPTION_KEY", ENCRYPTION_KEY);
  mockPrisma.operationalEvent.create.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// --- helpers ---------------------------------------------------------------

function jsonResponse(payload: unknown, ok = true) {
  return { ok, json: async () => payload } as Response;
}

/** Route fetch by the graph endpoint each helper hits. */
function stubGraph(handlers: {
  shortToken?: unknown;
  longToken?: unknown;
  pages?: unknown[];
  subscribe?: { payload: unknown; ok?: boolean };
}) {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.includes("fb_exchange_token")) {
      return jsonResponse(handlers.longToken ?? { access_token: USER_TOKEN });
    }
    if (input.includes("/oauth/access_token")) {
      return jsonResponse(handlers.shortToken ?? { access_token: "short" });
    }
    if (input.includes("/me/accounts")) {
      return jsonResponse({ data: handlers.pages ?? [], paging: {} });
    }
    if (input.includes("/subscribed_apps")) {
      const sub = handlers.subscribe ?? { payload: { success: true } };
      return jsonResponse(sub.payload, sub.ok ?? true);
    }
    throw new Error(`unexpected fetch: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestWithToken(method: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.cookie = `${COOKIE_NAME}=${encodeURIComponent(encryptToken(token))}`;
  }
  return new NextRequest(`${BASE_URL}/api/facebook/pages`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function callbackRequest(params: Record<string, string>) {
  const url = new URL(`${BASE_URL}/api/facebook/callback`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url);
}

function connectedContext(role = "ADMIN") {
  mockContext.mockResolvedValue({
    userId: "user_1",
    workspaceId: WORKSPACE,
    workspace: { id: WORKSPACE },
    role,
  });
}

function locationOf(response: Response) {
  return response.headers.get("location") ?? "";
}

// --- connect ---------------------------------------------------------------

describe("GET /api/facebook/connect", () => {
  it("redirects an unauthenticated visitor to /login", async () => {
    mockContext.mockResolvedValue(null);
    expect(locationOf(await connect())).toBe(`${BASE_URL}/login`);
  });

  it("rejects a member without manage rights", async () => {
    connectedContext("MEMBER");
    expect(locationOf(await connect())).toBe(
      `${BASE_URL}/settings?facebook=forbidden`
    );
  });

  it("redirects to settings when OAuth env is missing", async () => {
    connectedContext();
    vi.stubEnv("FACEBOOK_APP_ID", "");
    const location = locationOf(await connect());
    expect(location).toContain("facebook=misconfigured");
    expect(location).toContain("FACEBOOK_APP_ID");
  });

  it("redirects to the Facebook dialog with a signed state", async () => {
    connectedContext();
    const location = new URL(locationOf(await connect()));
    expect(location.origin).toBe("https://www.facebook.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${BASE_URL}/api/facebook/callback`
    );
    expect(location.searchParams.get("state")).toBeTruthy();
  });
});

// --- callback --------------------------------------------------------------

describe("GET /api/facebook/callback", () => {
  it("redirects to an error when the user denied the dialog", async () => {
    const location = locationOf(
      await callback(callbackRequest({ error: "access_denied" }))
    );
    expect(location).toBe(`${BASE_URL}/settings?facebook=denied`);
  });

  it("rejects a state that fails verification", async () => {
    const location = locationOf(
      await callback(callbackRequest({ code: "auth-code", state: "forged.sig" }))
    );
    expect(location).toBe(`${BASE_URL}/settings?facebook=invalid`);
  });

  it("stashes the long-lived token in an encrypted 10-minute cookie", async () => {
    stubGraph({ longToken: { access_token: USER_TOKEN } });
    mockAuth.mockResolvedValue({ user: { id: "user_1" } });
    mockPrisma.workspaceMember.findFirst.mockResolvedValue({ role: "ADMIN" });

    const state = createOAuthState(WORKSPACE);
    const response = await callback(
      callbackRequest({ code: "auth-code", state })
    );

    expect(locationOf(response)).toBe(`${BASE_URL}/settings?facebook=select_page`);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=600");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).toContain("Path=/api/facebook");

    const value = response.cookies.get(COOKIE_NAME)?.value ?? "";
    expect(value).not.toContain(USER_TOKEN);
    expect(decryptToken(value)).toBe(USER_TOKEN);
  });
});

// --- pages GET -------------------------------------------------------------

describe("GET /api/facebook/pages", () => {
  it("redirects when the transient token cookie is absent", async () => {
    connectedContext();
    const response = await listPages(requestWithToken("GET", null));
    expect(locationOf(response)).toBe(
      `${BASE_URL}/settings?facebook=session_expired`
    );
  });

  it("paginates /me/accounts and flags cross-workspace Pages", async () => {
    connectedContext();
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("cursor=2")) {
        return jsonResponse({ data: [page("page_b", "Page B")], paging: {} });
      }
      return jsonResponse({
        data: [page("page_a", "Page A")],
        paging: { next: `${BASE_URL}/graph?cursor=2` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    mockPrisma.socialAccount.findUnique.mockImplementation(
      async ({ where }: { where: { platform_externalId: { externalId: string } } }) =>
        where.platform_externalId.externalId === "page_b"
          ? { workspaceId: "other_workspace" }
          : null
    );

    const response = await listPages(requestWithToken("GET", USER_TOKEN));
    const body = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.pages).toEqual([
      { id: "page_a", name: "Page A", category: "Business", alreadyConnected: false },
      { id: "page_b", name: "Page B", category: "Business", alreadyConnected: true },
    ]);
    expect(JSON.stringify(body)).not.toContain("page-token");
  });
});

// --- pages POST ------------------------------------------------------------

describe("POST /api/facebook/pages", () => {
  it("rejects a member without manage rights", async () => {
    connectedContext("MEMBER");
    const response = await connectPage(
      requestWithToken("POST", USER_TOKEN, { pageId: "page_a" })
    );
    expect(locationOf(response)).toBe(`${BASE_URL}/settings?facebook=forbidden`);
  });

  it("rejects a Page already connected to another workspace", async () => {
    connectedContext();
    stubGraph({ pages: [page("page_a", "Page A")] });
    mockPrisma.socialAccount.findUnique.mockResolvedValue({
      workspaceId: "other_workspace",
    });

    const response = await connectPage(
      requestWithToken("POST", USER_TOKEN, { pageId: "page_a" })
    );

    expect(locationOf(response)).toBe(
      `${BASE_URL}/settings?facebook=already_connected`
    );
    expect(mockPrisma.socialAccount.upsert).not.toHaveBeenCalled();
  });

  it("stores the Page with a null expiry, an encrypted token, and clears the cookie", async () => {
    connectedContext();
    stubGraph({ pages: [page("page_a", "Page A")], subscribe: { payload: { success: true } } });
    mockPrisma.socialAccount.findUnique.mockResolvedValue(null);
    mockPrisma.socialAccount.upsert.mockResolvedValue({});

    const response = await connectPage(
      requestWithToken("POST", USER_TOKEN, { pageId: "page_a" })
    );

    expect(locationOf(response)).toBe(`${BASE_URL}/settings?facebook=connected`);
    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    const args = mockPrisma.socialAccount.upsert.mock.calls[0][0];
    expect(args.create.platform).toBe("FACEBOOK");
    expect(args.create.externalId).toBe("page_a");
    expect(args.create.tokenExpiresAt).toBeNull();
    expect(args.create.webhookSubscribed).toBe(true);
    expect(decryptToken(args.create.accessToken)).toBe("page_a-token");
  });

  it("records webhookSubscribed=false when the subscribe call fails", async () => {
    connectedContext();
    stubGraph({
      pages: [page("page_a", "Page A")],
      subscribe: { payload: { error: { message: "no perms", code: 200 } }, ok: false },
    });
    mockPrisma.socialAccount.findUnique.mockResolvedValue(null);
    mockPrisma.socialAccount.upsert.mockResolvedValue({});

    const response = await connectPage(
      requestWithToken("POST", USER_TOKEN, { pageId: "page_a" })
    );

    expect(locationOf(response)).toBe(`${BASE_URL}/settings?facebook=connected`);
    const args = mockPrisma.socialAccount.upsert.mock.calls[0][0];
    expect(args.create.webhookSubscribed).toBe(false);
  });
});

function page(id: string, name: string) {
  return { id, name, access_token: `${id}-token`, category: "Business" };
}
