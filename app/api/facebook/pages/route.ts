import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectSocialAccount } from "@/lib/social-accounts";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";
import {
  encryptToken,
  getFacebookUserPages,
  subscribeFacebookPageToWebhooks,
  type FacebookPage,
} from "@/lib/meta/facebook-oauth";
import { clearUserToken, readUserToken } from "@/lib/meta/facebook-connect-session";

// A Page offered to the picker. The Page access token is deliberately omitted —
// the client only needs to choose an id; the server re-reads the token itself.
interface PickablePage {
  id: string;
  name: string;
  category?: string;
  alreadyConnected: boolean;
}

// POST redirects a form-style selection back to the settings page, so 303 turns
// the POST into a GET on the destination.
const SEE_OTHER = 303;

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl();
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${baseUrl}/login`);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=forbidden`);
  }

  const userToken = readUserToken(request);
  if (!userToken) {
    return NextResponse.redirect(`${baseUrl}/settings?facebook=session_expired`);
  }

  try {
    const pages = await getFacebookUserPages(userToken);
    const pickable = await toPickablePages(pages, context.workspaceId);
    return NextResponse.json({ pages: pickable });
  } catch (err) {
    return failureRedirect(baseUrl, err);
  }
}

export async function POST(request: NextRequest) {
  const baseUrl = getBaseUrl();
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.redirect(`${baseUrl}/login`, SEE_OTHER);
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=forbidden`,
      SEE_OTHER
    );
  }

  const userToken = readUserToken(request);
  if (!userToken) {
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=session_expired`,
      SEE_OTHER
    );
  }

  const body = await request.json().catch(() => ({}));
  const pageId = typeof body.pageId === "string" ? body.pageId : null;
  if (!pageId) {
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=invalid`,
      SEE_OTHER
    );
  }

  try {
    return await connectPage(baseUrl, context.workspaceId, userToken, pageId);
  } catch (err) {
    console.error("[Facebook Pages] Error:", err);
    await recordFailure(context.workspaceId, err);
    return failureRedirect(baseUrl, err, SEE_OTHER);
  }
}

// Re-fetch /me/accounts with the stashed user token so the Page token comes from
// Meta, never from the client, then persist the chosen Page and subscribe it to
// webhooks. The transient user-token cookie is cleared once the Page is stored.
async function connectPage(
  baseUrl: string,
  workspaceId: string,
  userToken: string,
  pageId: string
): Promise<NextResponse> {
  const pages = await getFacebookUserPages(userToken);
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=invalid`,
      SEE_OTHER
    );
  }

  const connection = await canConnectSocialAccount({
    workspaceId,
    externalId: page.id,
    platform: "FACEBOOK",
  });
  if (!connection.allowed) {
    return NextResponse.redirect(
      `${baseUrl}/settings?facebook=already_connected`,
      SEE_OTHER
    );
  }

  const webhookSubscribed = await subscribePageQuietly(page);
  await upsertPageAccount(workspaceId, page, webhookSubscribed);

  const response = NextResponse.redirect(
    `${baseUrl}/settings?facebook=connected`,
    SEE_OTHER
  );
  clearUserToken(response);
  return response;
}

async function toPickablePages(
  pages: FacebookPage[],
  workspaceId: string
): Promise<PickablePage[]> {
  return Promise.all(
    pages.map(async (page) => {
      const connection = await canConnectSocialAccount({
        workspaceId,
        externalId: page.id,
        platform: "FACEBOOK",
      });
      return {
        id: page.id,
        name: page.name,
        category: page.category,
        alreadyConnected: !connection.allowed,
      };
    })
  );
}

// A failed webhook subscribe must not abort the connect: the Page is still
// usable via polling, so record the outcome and carry on.
async function subscribePageQuietly(page: FacebookPage): Promise<boolean> {
  try {
    const subscription = await subscribeFacebookPageToWebhooks(
      page.id,
      page.access_token
    );
    return Boolean(subscription.success);
  } catch (subscriptionError) {
    console.warn(
      "[Facebook Pages] Webhook subscription failed:",
      subscriptionError
    );
    return false;
  }
}

// Page tokens do not expire while the user token is valid, so tokenExpiresAt is
// null — there is no refresh clock to track for a Page.
async function upsertPageAccount(
  workspaceId: string,
  page: FacebookPage,
  webhookSubscribed: boolean
): Promise<void> {
  const accessToken = encryptToken(page.access_token);
  await prisma.socialAccount.upsert({
    where: { platform_externalId: { platform: "FACEBOOK", externalId: page.id } },
    create: {
      workspaceId,
      platform: "FACEBOOK",
      externalId: page.id,
      username: page.name,
      name: page.name,
      accessToken,
      tokenExpiresAt: null,
      webhookSubscribed,
    },
    update: {
      workspaceId,
      username: page.name,
      name: page.name,
      accessToken,
      tokenExpiresAt: null,
      webhookSubscribed,
    },
  });
}

async function recordFailure(workspaceId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : "Unknown error";
  await prisma.operationalEvent
    .create({
      data: {
        source: "SYSTEM",
        level: "ERROR",
        workspaceId,
        message: "Facebook Page connection failed",
        payload: { reason: message },
      },
    })
    .catch(() => {});
}

function failureRedirect(
  baseUrl: string,
  err: unknown,
  status?: number
): NextResponse {
  const message = err instanceof Error ? err.message : "Unknown error";
  const url = `${baseUrl}/settings?facebook=failed&reason=${encodeURIComponent(
    message.slice(0, 200)
  )}`;
  return status ? NextResponse.redirect(url, status) : NextResponse.redirect(url);
}
