import type { SocialPlatform } from "@/app/generated/prisma/client";

/**
 * The channel provider seam. Each social platform (Instagram, and later
 * Facebook) implements this one contract; the worker, reconciler, and routes
 * resolve a provider by platform instead of calling a platform-specific client
 * directly.
 *
 * Providers are I/O only. They translate a normalized params object into the
 * platform API call and translate the platform response back into a normalized
 * value object. No business rules live here, and no Graph/library types cross
 * this boundary — comments, posts, and conversations are returned as the
 * normalized shapes below.
 *
 * Method params are objects (never positional) because every call carries more
 * than two arguments, per the project baseline.
 */
export interface ChannelProvider {
  readonly platform: SocialPlatform;

  sendPrivateReply(p: SendPrivateReplyParams): Promise<SendResult>;
  sendPrivateReplyWithButton(
    p: SendPrivateReplyWithButtonParams
  ): Promise<SendResult>;
  sendPrivateReplyWithLinkButton(
    p: SendPrivateReplyWithLinkButtonParams
  ): Promise<SendResult>;

  sendDirectMessage(p: SendDirectMessageParams): Promise<SendResult>;
  sendDirectMessageWithButton(
    p: SendDirectMessageWithButtonParams
  ): Promise<SendResult>;
  sendDirectMessageWithLinkButton(
    p: SendDirectMessageWithLinkButtonParams
  ): Promise<SendResult>;

  replyToComment(p: ReplyToCommentParams): Promise<void>;

  getRecentComments(p: GetRecentCommentsParams): Promise<ChannelComment[]>;
  listPosts(p: ListPostsParams): Promise<ChannelPost[]>;
  getConversations(p: GetConversationsParams): Promise<ChannelConversation[]>;

  subscribeWebhooks(p: SubscribeWebhooksParams): Promise<{ success: boolean }>;

  /** Whether the platform has a follow gate at all. false triggers FR-5 (degrade visibly). */
  readonly hasFollowGate: boolean;

  /** null = the follow status could not be determined (e.g. a transient API error). */
  getFollowStatus(p: GetFollowStatusParams): Promise<boolean | null>;

  /** null = refreshing tokens is a no-op on this platform. */
  refreshToken(p: RefreshTokenParams): Promise<TokenRefresh | null>;
}

// --- Shared value objects ------------------------------------------------

/**
 * Result of a message send. Shaped to match what the Meta client already
 * returns so the Instagram adapter stays a thin pass-through.
 */
export interface SendResult {
  recipient_id: string;
  message_id: string;
}

/** Result of refreshing a long-lived token. Matches the Meta client's shape. */
export interface TokenRefresh {
  accessToken: string;
  expiresIn: number;
}

/** A tappable web_url button in a message button template. */
export interface LinkButton {
  title: string;
  url: string;
}

/**
 * A comment, normalized across platforms. `ownerReplied` abstracts the
 * platform difference in how "the account owner already answered this" is
 * expressed (Instagram's reply edge vs. Facebook's nested comments).
 */
export interface ChannelComment {
  id: string;
  text: string;
  authorId: string;
  authorName?: string;
  timestamp: string;
  ownerReplied: boolean;
}

/** A published post/media, normalized across platforms. */
export interface ChannelPost {
  id: string;
  caption?: string;
  thumbnailUrl?: string;
  timestamp: string;
  permalink?: string;
}

export interface ChannelParticipant {
  id: string;
  username?: string;
}

export interface ChannelMessage {
  id: string;
  text?: string;
  from?: ChannelParticipant;
  createdTime?: string;
}

/** A DM conversation with a one-message preview, normalized across platforms. */
export interface ChannelConversation {
  id: string;
  updatedTime?: string;
  participants: ChannelParticipant[];
  lastMessage?: ChannelMessage;
}

// --- Method params -------------------------------------------------------

export interface SendPrivateReplyParams {
  accessToken: string;
  accountId: string;
  commentId: string;
  message: string;
}

export interface SendPrivateReplyWithButtonParams {
  accessToken: string;
  accountId: string;
  commentId: string;
  text: string;
  buttonTitle: string;
  payload: string;
}

export interface SendPrivateReplyWithLinkButtonParams {
  accessToken: string;
  accountId: string;
  commentId: string;
  text: string;
  buttons: LinkButton[];
}

export interface SendDirectMessageParams {
  accessToken: string;
  accountId: string;
  userId: string;
  message: string;
}

export interface SendDirectMessageWithButtonParams {
  accessToken: string;
  accountId: string;
  userId: string;
  text: string;
  buttonTitle: string;
  payload: string;
}

export interface SendDirectMessageWithLinkButtonParams {
  accessToken: string;
  accountId: string;
  userId: string;
  text: string;
  buttons: LinkButton[];
}

export interface ReplyToCommentParams {
  accessToken: string;
  commentId: string;
  message: string;
}

export interface GetRecentCommentsParams {
  accessToken: string;
  mediaId: string;
  sinceMs: number;
  /** The account owner's external id, used to derive `ownerReplied`. */
  ownerId: string;
  max?: number;
}

export interface ListPostsParams {
  accessToken: string;
  max?: number;
}

export interface GetConversationsParams {
  accessToken: string;
  accountId: string;
}

export interface SubscribeWebhooksParams {
  accessToken: string;
  accountId: string;
}

export interface GetFollowStatusParams {
  accessToken: string;
  recipientId: string;
}

export interface RefreshTokenParams {
  token: string;
}
