import { SocialPlatform } from "@/app/generated/prisma/client";
import { subscribeFacebookPageToWebhooks } from "@/lib/meta/facebook-oauth";
import { facebookGraphBase, handleResponse } from "@/lib/meta/client";
import type {
  ChannelComment,
  ChannelConversation,
  ChannelPost,
  ChannelProvider,
  GetConversationsParams,
  GetFollowerCountParams,
  GetRecentCommentsParams,
  LinkButton,
  ListPostsParams,
  ReplyToCommentParams,
  SendDirectMessageParams,
  SendDirectMessageWithButtonParams,
  SendDirectMessageWithLinkButtonParams,
  SendPrivateReplyParams,
  SendPrivateReplyWithButtonParams,
  SendPrivateReplyWithLinkButtonParams,
  SendResult,
  SubscribeWebhooksParams,
} from "@/lib/channels/types";

/**
 * The Facebook Pages channel provider. Unlike the Instagram provider — which
 * delegates to an existing client — this speaks a second Graph dialect
 * (`graph.facebook.com`) directly and normalizes every response to the same
 * `ChannelProvider` contract. No Graph shape leaks past this module: callers see
 * only the normalized value objects.
 *
 * Facebook has no follow gate, so `hasFollowGate` is false (the load-bearing
 * signal that lets the pipeline degrade visibly) and `getFollowStatus` always
 * resolves null. Page tokens never expire, so `refreshToken` is a no-op.
 */
export const facebookProvider: ChannelProvider = {
  platform: SocialPlatform.FACEBOOK,
  hasFollowGate: false,
  // No follower_count-style insight exists for Pages, so there is nothing to
  // reconstruct history from (FR-8) — the daily snapshot skips backfill.
  hasFollowerHistoryBackfill: false,

  sendPrivateReply(p: SendPrivateReplyParams) {
    return sendMessage(p.accessToken, p.accountId, {
      recipient: { comment_id: p.commentId },
      message: { text: p.message },
    });
  },

  sendPrivateReplyWithButton(p: SendPrivateReplyWithButtonParams) {
    return sendMessage(p.accessToken, p.accountId, {
      recipient: { comment_id: p.commentId },
      message: buttonTemplate(p.text, postbackButtons(p.buttonTitle, p.payload)),
    });
  },

  sendPrivateReplyWithLinkButton(p: SendPrivateReplyWithLinkButtonParams) {
    return sendMessage(p.accessToken, p.accountId, {
      recipient: { comment_id: p.commentId },
      message: buttonTemplate(p.text, webUrlButtons(p.buttons)),
    });
  },

  sendDirectMessage(p: SendDirectMessageParams) {
    return sendMessage(p.accessToken, p.accountId, {
      recipient: { id: p.userId },
      message: { text: p.message },
    });
  },

  sendDirectMessageWithButton(p: SendDirectMessageWithButtonParams) {
    return sendMessage(p.accessToken, p.accountId, {
      recipient: { id: p.userId },
      message: buttonTemplate(p.text, postbackButtons(p.buttonTitle, p.payload)),
    });
  },

  sendDirectMessageWithLinkButton(p: SendDirectMessageWithLinkButtonParams) {
    return sendMessage(p.accessToken, p.accountId, {
      recipient: { id: p.userId },
      message: buttonTemplate(p.text, webUrlButtons(p.buttons)),
    });
  },

  async replyToComment(p: ReplyToCommentParams) {
    const response = await fetch(`${facebookGraphBase()}/${p.commentId}/comments`, {
      method: "POST",
      headers: authHeaders(p.accessToken),
      body: JSON.stringify({ message: p.message }),
    });
    await handleResponse(response);
  },

  async getRecentComments(p: GetRecentCommentsParams): Promise<ChannelComment[]> {
    const comments = await fetchRecentComments(p);
    return comments
      .filter((c) => c.from)
      .map((c) => toChannelComment(c, p.ownerId));
  },

  async listPosts(p: ListPostsParams): Promise<ChannelPost[]> {
    const [posts, reels] = await Promise.all([
      fetchPublishedPosts(p.accessToken, p.max),
      fetchVideoReels(p.accessToken, p.max),
    ]);
    return [...posts, ...reels].sort(byTimestampDesc);
  },

  async getConversations(
    p: GetConversationsParams
  ): Promise<ChannelConversation[]> {
    const conversations = await fetchConversations(p.accessToken, p.accountId);
    return conversations.map(toChannelConversation);
  },

  subscribeWebhooks(p: SubscribeWebhooksParams) {
    return subscribeFacebookPageToWebhooks(p.accountId, p.accessToken);
  },

  // Facebook has no follow gate — `hasFollowGate: false` is the load-bearing
  // signal — so follow status is never determinable.
  async getFollowStatus(): Promise<boolean | null> {
    return null;
  },

  async getFollowerCount(p: GetFollowerCountParams): Promise<number | null> {
    const url = new URL(`${facebookGraphBase()}/${p.accountId}`);
    url.searchParams.set("fields", "fan_count");
    url.searchParams.set("access_token", p.accessToken);

    const response = await fetch(url.toString());
    const data = await handleResponse<{ fan_count?: number }>(response);
    return typeof data.fan_count === "number" ? data.fan_count : null;
  },

  // Page tokens never expire, so refreshing is a no-op on this platform.
  async refreshToken(): Promise<null> {
    return null;
  },
};

// --- Message sends -------------------------------------------------------

// Button-template limits Meta enforces, shared across every send variant.
const BUTTON_TEMPLATE_TEXT_MAX = 640;
const BUTTON_TITLE_MAX = 20;
const MAX_WEB_URL_BUTTONS = 3;

interface MessagePayload {
  recipient: { comment_id: string } | { id: string };
  message: unknown;
}

async function sendMessage(
  accessToken: string,
  pageId: string,
  payload: MessagePayload
): Promise<SendResult> {
  // Messenger requires messaging_type on user-id sends (all our DMs are
  // RESPONSE — sent inside the window a comment/postback/inbound message opened).
  // Private replies (recipient.comment_id) must NOT carry it.
  const body =
    "id" in payload.recipient
      ? { ...payload, messaging_type: "RESPONSE" }
      : payload;
  const response = await fetch(`${facebookGraphBase()}/${pageId}/messages`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  return handleResponse<SendResult>(response);
}

function buttonTemplate(text: string, buttons: unknown[]) {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, BUTTON_TEMPLATE_TEXT_MAX),
        buttons,
      },
    },
  };
}

function postbackButtons(title: string, payload: string) {
  return [
    { type: "postback", title: title.slice(0, BUTTON_TITLE_MAX), payload },
  ];
}

function webUrlButtons(buttons: LinkButton[]) {
  return buttons
    .slice(0, MAX_WEB_URL_BUTTONS)
    .map((b) => ({
      type: "web_url",
      url: b.url,
      title: b.title.slice(0, BUTTON_TITLE_MAX),
    }));
}

function authHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

// --- Comments ------------------------------------------------------------

interface FacebookComment {
  id: string;
  message?: string;
  from?: { id: string; name?: string };
  created_time: string;
  comments?: { data?: { from?: { id: string } }[] };
}

// A comment page's worth of comments before lookback filtering, newest first.
const COMMENTS_PAGE_SIZE = 50;
const COMMENTS_MAX = 800;

/**
 * Recent comments on a post, newest first, each carrying its nested replies so
 * the caller can derive `ownerReplied`. Pagination stops as soon as it reaches a
 * comment older than `sinceMs`, so a viral post's whole back-catalogue is never
 * pulled — only what is recent enough to still act on.
 */
async function fetchRecentComments(
  p: GetRecentCommentsParams
): Promise<FacebookComment[]> {
  const max = p.max ?? COMMENTS_MAX;
  const results: FacebookComment[] = [];

  const first = new URL(`${facebookGraphBase()}/${p.mediaId}/comments`);
  first.searchParams.set(
    "fields",
    "id,message,from{id,name},created_time,comments{from{id}}"
  );
  first.searchParams.set("order", "reverse_chronological");
  first.searchParams.set("limit", String(COMMENTS_PAGE_SIZE));
  first.searchParams.set("access_token", p.accessToken);

  let nextUrl: string | null = first.toString();

  while (nextUrl !== null && results.length < max) {
    const response: Response = await fetch(nextUrl);
    const page = await handleResponse<{
      data: FacebookComment[];
      paging?: { next?: string };
    }>(response);
    const data = page.data ?? [];
    results.push(...data);

    const oldest = data[data.length - 1];
    if (oldest?.created_time && Date.parse(oldest.created_time) < p.sinceMs) {
      break;
    }
    nextUrl = page.paging?.next ?? null;
  }

  return results
    .filter((c) => !c.created_time || Date.parse(c.created_time) >= p.sinceMs)
    .slice(0, max);
}

function toChannelComment(
  comment: FacebookComment,
  ownerId: string
): ChannelComment {
  const ownerReplied = (comment.comments?.data ?? []).some(
    (reply) => reply.from?.id === ownerId
  );
  return {
    id: comment.id,
    text: comment.message ?? "",
    authorId: comment.from?.id ?? "",
    authorName: comment.from?.name,
    timestamp: comment.created_time,
    ownerReplied,
  };
}

// --- Posts (published posts + reels) -------------------------------------

interface FacebookPublishedPost {
  id: string;
  message?: string;
  full_picture?: string;
  created_time: string;
  permalink_url?: string;
}

interface FacebookVideoReel {
  id: string;
  description?: string;
  picture?: string;
  created_time: string;
  permalink_url?: string;
}

// Facebook caps a single feed page at 100 items, matching the Instagram client.
const POSTS_PAGE_SIZE = 100;
const POSTS_MAX = 500;

async function fetchPublishedPosts(
  accessToken: string,
  max = POSTS_MAX
): Promise<ChannelPost[]> {
  const url = new URL(`${facebookGraphBase()}/me/published_posts`);
  url.searchParams.set(
    "fields",
    "id,message,full_picture,created_time,permalink_url"
  );
  url.searchParams.set("limit", String(Math.min(POSTS_PAGE_SIZE, max)));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data?: FacebookPublishedPost[] }>(response);
  return (data.data ?? []).map(toPostFromPublished);
}

async function fetchVideoReels(
  accessToken: string,
  max = POSTS_MAX
): Promise<ChannelPost[]> {
  const url = new URL(`${facebookGraphBase()}/me/video_reels`);
  url.searchParams.set(
    "fields",
    "id,description,picture,created_time,permalink_url"
  );
  url.searchParams.set("limit", String(Math.min(POSTS_PAGE_SIZE, max)));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data?: FacebookVideoReel[] }>(response);
  return (data.data ?? []).map(toPostFromReel);
}

function toPostFromPublished(post: FacebookPublishedPost): ChannelPost {
  return {
    id: post.id,
    caption: post.message,
    thumbnailUrl: post.full_picture,
    timestamp: post.created_time,
    permalink: post.permalink_url,
  };
}

function toPostFromReel(reel: FacebookVideoReel): ChannelPost {
  return {
    id: reel.id,
    caption: reel.description,
    thumbnailUrl: reel.picture,
    timestamp: reel.created_time,
    permalink: reel.permalink_url,
  };
}

function byTimestampDesc(a: ChannelPost, b: ChannelPost): number {
  return Date.parse(b.timestamp) - Date.parse(a.timestamp);
}

// --- Conversations -------------------------------------------------------

interface FacebookParticipant {
  id: string;
  name?: string;
}

interface FacebookMessage {
  id: string;
  created_time?: string;
  message?: string;
  from?: FacebookParticipant;
}

interface FacebookConversation {
  id: string;
  updated_time?: string;
  participants?: { data: FacebookParticipant[] };
  messages?: { data: FacebookMessage[] };
}

const CONVERSATIONS_PAGE_SIZE = 50;

async function fetchConversations(
  accessToken: string,
  pageId: string
): Promise<FacebookConversation[]> {
  const url = new URL(`${facebookGraphBase()}/${pageId}/conversations`);
  url.searchParams.set("platform", "messenger");
  url.searchParams.set(
    "fields",
    "participants,updated_time,messages.limit(1){message,from,created_time}"
  );
  url.searchParams.set("limit", String(CONVERSATIONS_PAGE_SIZE));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const data = await handleResponse<{ data?: FacebookConversation[] }>(response);
  return data.data ?? [];
}

function toChannelConversation(
  conversation: FacebookConversation
): ChannelConversation {
  const participants = (conversation.participants?.data ?? []).map((p) => ({
    id: p.id,
    username: p.name,
  }));
  const preview = conversation.messages?.data?.[0];
  return {
    id: conversation.id,
    updatedTime: conversation.updated_time,
    participants,
    lastMessage: preview
      ? {
          id: preview.id,
          text: preview.message,
          from: preview.from
            ? { id: preview.from.id, username: preview.from.name }
            : undefined,
          createdTime: preview.created_time,
        }
      : undefined,
  };
}
