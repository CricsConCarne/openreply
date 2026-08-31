import type { NextRequest, NextResponse } from "next/server";
import { decryptToken, encryptToken } from "@/lib/meta/facebook-oauth";

// The long-lived Facebook USER token is needed only between the OAuth callback
// and the moment a Page is picked. It is never persisted to the database: it
// lives in an encrypted, httpOnly cookie scoped to /api/facebook that expires
// after 10 minutes, so the selection step cannot outlive a single connect.
const COOKIE_NAME = "fb_connect_user_token";
const COOKIE_PATH = "/api/facebook";
const COOKIE_MAX_AGE_SECONDS = 600;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: COOKIE_PATH,
} as const;

export function stashUserToken(response: NextResponse, userToken: string): void {
  response.cookies.set(COOKIE_NAME, encryptToken(userToken), {
    ...COOKIE_OPTIONS,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function readUserToken(request: NextRequest): string | null {
  const encrypted = request.cookies.get(COOKIE_NAME)?.value;
  if (!encrypted) return null;

  try {
    return decryptToken(encrypted);
  } catch {
    return null;
  }
}

export function clearUserToken(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", { ...COOKIE_OPTIONS, maxAge: 0 });
}
