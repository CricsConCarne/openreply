import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOAuthState,
  exchangeCodeForFacebookToken,
  exchangeForLongLivedUserToken,
  getFacebookAuthorizationUrl,
  getFacebookUserPages,
  verifyOAuthState,
} from "../lib/meta/facebook-oauth";

const REDIRECT_URI = "https://app.example.com/api/facebook/callback";
const EXPECTED_SCOPES =
  "pages_show_list,pages_messaging,pages_read_engagement,pages_manage_engagement,pages_manage_metadata,business_management";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length");
  vi.stubEnv("FACEBOOK_APP_ID", "fb-app-id");
  vi.stubEnv("FACEBOOK_APP_SECRET", "fb-app-secret");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mockFetchJson(payload: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    url: "https://graph.facebook.com/v25.0/oauth/access_token",
    json: async () => payload,
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getFacebookAuthorizationUrl", () => {
  it("builds the dialog URL with the client id, redirect, state, and scopes", () => {
    const url = new URL(getFacebookAuthorizationUrl(REDIRECT_URI, "state-token"));

    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toBe("/v25.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("fb-app-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(EXPECTED_SCOPES);
  });
});

describe("exchangeCodeForFacebookToken", () => {
  it("exchanges a code for a short-lived user token", async () => {
    const fetchMock = mockFetchJson({
      access_token: "short-lived-token",
      token_type: "bearer",
      expires_in: 5183944,
    });

    const result = await exchangeCodeForFacebookToken({
      code: "auth-code",
      redirectUri: REDIRECT_URI,
    });

    expect(result).toEqual({
      accessToken: "short-lived-token",
      expiresIn: 5183944,
    });

    const requestUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestUrl.origin).toBe("https://graph.facebook.com");
    expect(requestUrl.pathname).toBe("/v25.0/oauth/access_token");
    expect(requestUrl.searchParams.get("client_id")).toBe("fb-app-id");
    expect(requestUrl.searchParams.get("client_secret")).toBe("fb-app-secret");
    expect(requestUrl.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(requestUrl.searchParams.get("code")).toBe("auth-code");
  });

  it("throws with the Meta error message on a non-ok response", async () => {
    mockFetchJson(
      {
        error: {
          message: "This authorization code has expired.",
          type: "OAuthException",
          code: 100,
        },
      },
      false
    );

    await expect(
      exchangeCodeForFacebookToken({
        code: "stale-code",
        redirectUri: REDIRECT_URI,
      })
    ).rejects.toThrow("This authorization code has expired.");
  });
});

describe("exchangeForLongLivedUserToken", () => {
  it("exchanges a short-lived token for a long-lived one", async () => {
    const fetchMock = mockFetchJson({
      access_token: "long-lived-token",
      token_type: "bearer",
      expires_in: 5184000,
    });

    const result = await exchangeForLongLivedUserToken({
      shortLivedToken: "short-lived-token",
    });

    expect(result).toEqual({
      accessToken: "long-lived-token",
      expiresIn: 5184000,
    });

    const requestUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestUrl.pathname).toBe("/v25.0/oauth/access_token");
    expect(requestUrl.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(requestUrl.searchParams.get("client_id")).toBe("fb-app-id");
    expect(requestUrl.searchParams.get("client_secret")).toBe("fb-app-secret");
    expect(requestUrl.searchParams.get("fb_exchange_token")).toBe(
      "short-lived-token"
    );
  });

  it("falls back to the 60-day lifetime when expires_in is absent", async () => {
    mockFetchJson({ access_token: "long-lived-token" });

    const result = await exchangeForLongLivedUserToken({
      shortLivedToken: "short-lived-token",
    });

    expect(result.expiresIn).toBe(5184000);
  });

  it("throws with the Meta error message on a non-ok response", async () => {
    mockFetchJson(
      {
        error: {
          message: "Invalid OAuth access token.",
          type: "OAuthException",
          code: 190,
        },
      },
      false
    );

    await expect(
      exchangeForLongLivedUserToken({ shortLivedToken: "bad-token" })
    ).rejects.toThrow("Invalid OAuth access token.");
  });
});

describe("OAuth state round-trip (reused HMAC helper)", () => {
  it("verifies a freshly created state and returns the workspace id", () => {
    const state = createOAuthState("workspace_fb");
    expect(verifyOAuthState(state)?.workspaceId).toBe("workspace_fb");
  });

  it("rejects a tampered state", () => {
    const state = createOAuthState("workspace_fb");
    expect(verifyOAuthState(`${state}tampered`)).toBeNull();
  });

  it("rejects a null state", () => {
    expect(verifyOAuthState(null)).toBeNull();
  });
});

describe("getFacebookUserPages", () => {
  // Route a Graph fetch by URL substring so a single call to
  // getFacebookUserPages can walk /me/accounts, /me/businesses and the
  // per-business Page edges with different responses.
  function mockGraph(handler: (url: string) => { ok?: boolean; body: unknown } | "reject") {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const result = handler(url);
      if (result === "reject") throw new Error("network");
      return {
        ok: result.ok ?? true,
        url,
        json: async () => result.body,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("includes Business-Portfolio-owned Pages that /me/accounts omits", async () => {
    mockGraph((url) => {
      if (url.includes("/me/accounts")) return { body: { data: [] } };
      if (url.includes("/me/businesses")) return { body: { data: [{ id: "biz1" }] } };
      if (url.includes("/biz1/owned_pages"))
        return {
          body: {
            data: [
              { id: "page1", name: "DAS Replay", access_token: "page-token", category: "Business" },
            ],
          },
        };
      return { body: { data: [] } }; // client_pages
    });

    const pages = await getFacebookUserPages("user-token");

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      id: "page1",
      name: "DAS Replay",
      access_token: "page-token",
    });
  });

  it("resolves a Page token separately when the business edge omits it", async () => {
    mockGraph((url) => {
      if (url.includes("/me/accounts")) return { body: { data: [] } };
      if (url.includes("/me/businesses")) return { body: { data: [{ id: "biz1" }] } };
      if (url.includes("/biz1/owned_pages"))
        return { body: { data: [{ id: "page2", name: "Tokenless" }] } };
      if (url.includes("/biz1/client_pages")) return { body: { data: [] } };
      // Per-page token lookup: GET /page2?fields=access_token,name,category
      if (url.includes("/page2"))
        return { body: { access_token: "fetched-token", name: "Tokenless", category: "Brand" } };
      return { body: { data: [] } };
    });

    const pages = await getFacebookUserPages("user-token");

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ id: "page2", access_token: "fetched-token" });
  });

  it("degrades to directly-administered Pages when business access is unavailable", async () => {
    mockGraph((url) => {
      if (url.includes("/me/accounts"))
        return { body: { data: [{ id: "p0", name: "Direct Page", access_token: "t0" }] } };
      if (url.includes("/me/businesses")) return "reject"; // e.g. business_management not granted
      return { body: { data: [] } };
    });

    const pages = await getFacebookUserPages("user-token");

    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ id: "p0", access_token: "t0" });
  });
});
