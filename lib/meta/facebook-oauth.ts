import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import { MetaApiError } from "@/lib/meta/client";

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
const FACEBOOK_SCOPES =
  "pages_show_list,pages_messaging,pages_read_engagement,pages_manage_engagement,pages_manage_metadata";

// Long-lived user tokens last ~60 days; Meta omits expires_in on some
// responses, so fall back to the documented lifetime.
const LONG_LIVED_TOKEN_TTL_SECONDS = 5_184_000;

function facebookDialogBase(): string {
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth`;
}

function facebookGraphBase(): string {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
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
  const data = await parseTokenResponse(response);

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
  const data = await parseTokenResponse(response);

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? LONG_LIVED_TOKEN_TTL_SECONDS,
  };
}

interface GraphApiError {
  error?: {
    message: string;
    type?: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

// Mirrors handleResponse in lib/meta/client.ts: surface Meta's error body as a
// MetaApiError with a contextual message rather than returning a silent null.
async function parseTokenResponse(
  response: Response
): Promise<FacebookTokenResponse> {
  const data = await response.json();

  if (!response.ok || (data as GraphApiError).error) {
    const err = (data as GraphApiError).error;
    const code = err?.code ?? response.status;
    const subcode = err?.error_subcode;
    const traceId = err?.fbtrace_id;
    const message = `${err?.message ?? "Unknown Meta API error"} [code=${code} sub=${subcode ?? "-"} type=${err?.type ?? "-"} trace=${traceId ?? "-"}]`;
    throw new MetaApiError(code, subcode, traceId, message);
  }

  return data as FacebookTokenResponse;
}
