import { SocialPlatform } from "@/app/generated/prisma/client";
import {
  getAllUserMedia,
  getConversations,
  getRecentMediaComments,
  getUserFollowStatus,
  refreshLongLivedToken,
  sendCommentReply,
  sendDirectMessage,
  sendDirectMessageWithButton,
  sendDirectMessageWithLinkButton,
  sendPrivateReply,
  sendPrivateReplyWithButton,
  sendPrivateReplyWithLinkButton,
  subscribeInstagramAccountToWebhooks,
} from "@/lib/meta/client";
import type {
  InstagramComment,
  InstagramConversation,
  InstagramMedia,
} from "@/lib/meta/client";
import type {
  ChannelComment,
  ChannelConversation,
  ChannelPost,
  ChannelProvider,
  GetConversationsParams,
  GetFollowStatusParams,
  GetRecentCommentsParams,
  ListPostsParams,
  RefreshTokenParams,
  ReplyToCommentParams,
  SendDirectMessageParams,
  SendDirectMessageWithButtonParams,
  SendDirectMessageWithLinkButtonParams,
  SendPrivateReplyParams,
  SendPrivateReplyWithButtonParams,
  SendPrivateReplyWithLinkButtonParams,
  SubscribeWebhooksParams,
} from "@/lib/channels/types";

/**
 * The Instagram channel provider. Every method thinly delegates to the existing
 * Meta client, mapping the normalized params object onto the client's
 * positional arguments and the client's result onto the normalized value
 * object. Behavior is preserved bit-for-bit: same inputs produce the same
 * client calls and the same outputs.
 */
export const instagramProvider: ChannelProvider = {
  platform: SocialPlatform.INSTAGRAM,
  hasFollowGate: true,

  sendPrivateReply(p: SendPrivateReplyParams) {
    return sendPrivateReply(p.accessToken, p.accountId, p.commentId, p.message);
  },

  sendPrivateReplyWithButton(p: SendPrivateReplyWithButtonParams) {
    return sendPrivateReplyWithButton(
      p.accessToken,
      p.accountId,
      p.commentId,
      p.text,
      p.buttonTitle,
      p.payload
    );
  },

  sendPrivateReplyWithLinkButton(p: SendPrivateReplyWithLinkButtonParams) {
    return sendPrivateReplyWithLinkButton(
      p.accessToken,
      p.accountId,
      p.commentId,
      p.text,
      p.buttons
    );
  },

  sendDirectMessage(p: SendDirectMessageParams) {
    return sendDirectMessage(p.accessToken, p.accountId, p.userId, p.message);
  },

  sendDirectMessageWithButton(p: SendDirectMessageWithButtonParams) {
    return sendDirectMessageWithButton(
      p.accessToken,
      p.accountId,
      p.userId,
      p.text,
      p.buttonTitle,
      p.payload
    );
  },

  sendDirectMessageWithLinkButton(p: SendDirectMessageWithLinkButtonParams) {
    return sendDirectMessageWithLinkButton(
      p.accessToken,
      p.accountId,
      p.userId,
      p.text,
      p.buttons
    );
  },

  async replyToComment(p: ReplyToCommentParams) {
    await sendCommentReply(p.accessToken, p.commentId, p.message);
  },

  async getRecentComments(p: GetRecentCommentsParams) {
    const comments = await getRecentMediaComments(
      p.accessToken,
      p.mediaId,
      p.sinceMs,
      p.max
    );
    return comments.map((c) => toChannelComment(c, p.ownerId));
  },

  async listPosts(p: ListPostsParams) {
    const media = await getAllUserMedia(p.accessToken, p.max);
    return media.map(toChannelPost);
  },

  async getConversations(p: GetConversationsParams) {
    const conversations = await getConversations(p.accessToken, p.accountId);
    return conversations.map(toChannelConversation);
  },

  subscribeWebhooks(p: SubscribeWebhooksParams) {
    return subscribeInstagramAccountToWebhooks(p.accountId, p.accessToken);
  },

  getFollowStatus(p: GetFollowStatusParams) {
    return getUserFollowStatus(p.accessToken, p.recipientId);
  },

  refreshToken(p: RefreshTokenParams) {
    return refreshLongLivedToken(p.token);
  },
};

function toChannelComment(
  comment: InstagramComment,
  ownerId: string
): ChannelComment {
  const ownerReplied = (comment.replies?.data ?? []).some(
    (reply) => reply.from?.id === ownerId
  );
  return {
    id: comment.id,
    text: comment.text,
    authorId: comment.from?.id ?? "",
    authorName: comment.from?.username,
    timestamp: comment.timestamp,
    ownerReplied,
  };
}

function toChannelPost(media: InstagramMedia): ChannelPost {
  return {
    id: media.id,
    caption: media.caption,
    thumbnailUrl: media.thumbnail_url ?? media.media_url,
    timestamp: media.timestamp,
    permalink: media.permalink,
  };
}

function toChannelConversation(
  conversation: InstagramConversation
): ChannelConversation {
  const participants = (conversation.participants?.data ?? []).map((p) => ({
    id: p.id,
    username: p.username,
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
            ? { id: preview.from.id, username: preview.from.username }
            : undefined,
          createdTime: preview.created_time,
        }
      : undefined,
  };
}
