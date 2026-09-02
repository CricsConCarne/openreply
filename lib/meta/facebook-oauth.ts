import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import { facebookGraphBase, handleResponse } from "@/lib/meta/client";

// Facebook Login for Business: the authorization dialog lives on
// www.facebook.com, while the code and token exchanges run against the Graph
// API host. State signing and token encryption are shared with the Instagram
// module — see lib/meta/oauth.ts.
export {
  createOAuthState,
  verifyOAuthState,
  encryptToken,
  decryptToken,
} from "@/lib/meta/oauth";

// Facebook Login for Business needs these Page scopes to list the admin's
// Pages, read their engagement, and send/manage messages and comments on them.
// business_management additionally lets us enumerate Pages owned through a
// Business Portfolio, which never appear on the /me/accounts edge.
const FACEBOOK_SCOPES =
  "pages_show_list,pages_messaging,pages_read_engagement,pages_manage_engagement,pages_manage_metadata,business_management";

// Long-lived user tokens last ~60 days; Meta omits expires_in on some
// responses, so fall back to the documented lifetime.
const LONG_LIVED_TOKEN_TTL_SECONDS = 5_184_000;

function facebookDialogBase(): string {
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth`;
}

interface FacebookTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export function getFacebookAuthorizationUrl(
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: FACEBOOK_SCOPES,
  });

  return `${facebookDialogBase()}?${params.toString()}`;
}

export async function exchangeCodeForFacebookToken({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn?: number }> {
  const url = new URL(`${facebookGraphBase()}/oauth/access_token`);
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  const response = await fetch(url.toString());
  const data = await handleResponse<FacebookTokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

export async function exchangeForLongLivedUserToken({
  shortLivedToken,
}: {
  shortLivedToken: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const url = new URL(`${facebookGraphBase()}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  url.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<FacebookTokenResponse>(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? LONG_LIVED_TOKEN_TTL_SECONDS,
  };
}

// A Facebook Page the authenticated user administers. `access_token` is the
// Page-scoped token used to read the Page's engagement and manage its comments
// and messages; it never expires as long as the user token stays valid, which
// is why connected Pages persist with tokenExpiresAt = null.
export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category?: string;
}

// Webhook fields a connected Page subscribes the app to: new/edited comments and
// posts (feed) plus the messaging events the DM flows react to.
const FACEBOOK_WEBHOOK_FIELDS = [
  "feed",
  "messages",
  "messaging_postbacks",
  "message_reads",
] as const;

// Business Portfolio edges that expose Pages the user manages but does not
// administer directly. Both are checked because a Page can be owned by the
// user's own business (owned_pages) or shared into it by another (client_pages).
const BUSINESS_PAGE_EDGES = ["owned_pages", "client_pages"] as const;

// A Page as returned by a Pages edge. The Page-scoped `access_token` is present
// on /me/accounts but frequently omitted by the business edges, so it is
// optional here and resolved separately below.
interface PageEdgeEntry {
  id: string;
  name: string;
  access_token?: string;
  category?: string;
}

// List every Page the user can automate: the Pages they administer directly
// (/me/accounts) PLUS Pages owned or managed through their Business Portfolios
// (/me/businesses → owned_pages / client_pages). Business-owned Pages never
// appear on /me/accounts, so without this a user whose Page lives in a Business
// Portfolio sees an empty picker. Pages are de-duplicated by id, and any Page
// whose Page-scoped token cannot be obtained is dropped — it cannot be
// automated without one.
export async function getFacebookUserPages(
  userToken: string
): Promise<FacebookPage[]> {
  const byId = new Map<string, PageEdgeEntry>();

  for (const page of await fetchPagesFromEdge(
    `${facebookGraphBase()}/me/accounts`,
    userToken
  )) {
    byId.set(page.id, page);
  }

  for (const businessId of await fetchBusinessIds(userToken)) {
    for (const edge of BUSINESS_PAGE_EDGES) {
      const edgeUrl = `${facebookGraphBase()}/${businessId}/${edge}`;
      for (const page of await fetchPagesFromEdge(edgeUrl, userToken)) {
        if (!byId.has(page.id)) byId.set(page.id, page);
      }
    }
  }

  const resolved = await Promise.all(
    [...byId.values()].map((page) => resolvePageToken(page, userToken))
  );
  return resolved.filter((page): page is FacebookPage => page !== null);
}

// Follow paging.next over a Pages edge, requesting the Page-scoped token where
// the edge provides it.
async function fetchPagesFromEdge(
  edgeUrl: string,
  userToken: string
): Promise<PageEdgeEntry[]> {
  const pages: PageEdgeEntry[] = [];

  const first = new URL(edgeUrl);
  first.searchParams.set("fields", "id,name,access_token,category");
  first.searchParams.set("access_token", userToken);

  let nextUrl: string | null = first.toString();
  while (nextUrl !== null) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: PageEdgeEntry[];
      paging?: { next?: string };
    }>(response);
    pages.push(...(page.data ?? []));
    nextUrl = page.paging?.next ?? null;
  }

  return pages;
}

// The ids of every Business Portfolio the user belongs to. A failure here
// (no business access, or business_management not granted) yields no
// business-owned Pages rather than failing the whole connect — the user can
// still connect a directly-administered Page.
async function fetchBusinessIds(userToken: string): Promise<string[]> {
  const first = new URL(`${facebookGraphBase()}/me/businesses`);
  first.searchParams.set("fields", "id");
  first.searchParams.set("access_token", userToken);

  const ids: string[] = [];
  let nextUrl: string | null = first.toString();
  try {
    while (nextUrl !== null) {
      const response: Response = await fetch(nextUrl);
      const page = await handleResponse<{
        data: { id: string }[];
        paging?: { next?: string };
      }>(response);
      ids.push(...(page.data ?? []).map((business) => business.id));
      nextUrl = page.paging?.next ?? null;
    }
  } catch {
    return ids;
  }
  return ids;
}

// Ensure a Page carries its Page-scoped token. Business edges often omit it, so
// fetch it directly for those. Returns null when no token can be obtained (the
// user lacks a task on the Page), since such a Page cannot be automated.
async function resolvePageToken(
  page: PageEdgeEntry,
  userToken: string
): Promise<FacebookPage | null> {
  if (page.access_token) {
    return {
      id: page.id,
      name: page.name,
      access_token: page.access_token,
      category: page.category,
    };
  }

  try {
    const url = new URL(`${facebookGraphBase()}/${page.id}`);
    url.searchParams.set("fields", "access_token,name,category");
    url.searchParams.set("access_token", userToken);
    const response = await fetch(url.toString());
    const detail = await handleResponse<{
      access_token?: string;
      name?: string;
      category?: string;
    }>(response);
    if (!detail.access_token) return null;
    return {
      id: page.id,
      name: detail.name ?? page.name,
      access_token: detail.access_token,
      category: detail.category ?? page.category,
    };
  } catch {
    return null;
  }
}

// Subscribe the app to the Page's webhook fields using the Page token. Returns
// Meta's { success } acknowledgement so the caller can record whether realtime
// delivery is actually wired up for this Page.
export async function subscribeFacebookPageToWebhooks(
  pageId: string,
  pageToken: string
): Promise<{ success: boolean }> {
  const response = await fetch(
    `${facebookGraphBase()}/${pageId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pageToken}`,
      },
      body: JSON.stringify({ subscribed_fields: [...FACEBOOK_WEBHOOK_FIELDS] }),
    }
  );

  return handleResponse<{ success: boolean }>(response);
}
