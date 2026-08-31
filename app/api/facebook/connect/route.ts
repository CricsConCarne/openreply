import { NextResponse } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getBaseUrl, getMissingFacebookOAuthEnv } from "@/lib/env";
import {
  createOAuthState,
  getFacebookAuthorizationUrl,
} from "@/lib/meta/facebook-oauth";

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${getBaseUrl()}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${getBaseUrl()}/settings?facebook=forbidden`);
  }

  // getFacebookAuthorizationUrl and createOAuthState call requireEnv, which
  // throws. Without this check an incomplete .env surfaces as a 500 on a plain
  // <a> navigation, which reads to the user as the button doing nothing at all.
  const missingEnv = getMissingFacebookOAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/settings?facebook=misconfigured&missing=${encodeURIComponent(
        missingEnv.join(",")
      )}`
    );
  }

  const redirectUri = `${getBaseUrl()}/api/facebook/callback`;
  const state = createOAuthState(context.workspaceId);

  return NextResponse.redirect(getFacebookAuthorizationUrl(redirectUri, state));
}
