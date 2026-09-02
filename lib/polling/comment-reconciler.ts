/**
 * Comment reconciliation (polling safety net).
 *
 * Instagram webhooks are best-effort and never fire for a large class of
 * comments (collapsed "load more" comments, non-follower / low-signal accounts,
 * anything Instagram filters). Those comments are otherwise invisible: never
 * replied to, never DM'd.
 *
 * This sweep is deliberately narrow. For each active campaign it looks only at
 * that campaign's post, only at recent comments, and acts on a comment ONLY when
 * both are true:
 *   1. the comment matches the campaign keyword, and
 *   2. the account owner has not already replied to it.
 * The reply check consumes the channel provider's normalized `ownerReplied`
 * flag, so a comment you (or the tool) already answered is skipped — the poll
 * never re-touches handled comments, and the sweep never inspects raw Graph
 * reply edges. Each sweep is capped so it can never flood the comment API
 * (which Instagram rate-limits aggressively, error 368).
 *
 * It runs on an interval in the worker process because Vercel's free crons only
 * fire once a day. Matching and sending reuse the worker's processComment, so
 * rate limiting and logging behave exactly as for webhook-delivered comments.
 *
 * The same machinery drives the one-off Facebook lookback (`runLookback`): the
 * only differences are a wider window, a Facebook-only scope, a suppressed
 * public reply, and a per-comment send time computed by `planLookbackSend`
 * instead of "enqueue immediately". Those differences are captured in the
 * `EnqueuePlan` passed to `sweepCampaign`, so the enumeration/matching/dedup
 * logic is shared verbatim.
 *
 * Known limitation, handled not fixed: comments removed by Instagram's Hidden
 * Words / spam filter may not be returned by the Graph API at all. Disable that
 * filter on the account to widen results.
 */

import { prisma } from "@/lib/db/client";
import type { SocialPlatform } from "@/app/generated/prisma/client";
import { getDMQueue } from "@/lib/queue/client";
import type { CommentSource } from "@/lib/queue/client";
import { resolveChannel } from "@/lib/channels";
import type { ChannelComment } from "@/lib/channels";
import { MetaApiError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { planLookbackSend } from "@/lib/scheduling/lookback-window";

// Only consider comments from the last few days — older ones are outside
// Instagram's private-reply window anyway, so a DM to them would just fail.
const LOOKBACK_HOURS = Number(process.env.COMMENT_POLL_LOOKBACK_HOURS ?? 72);
// Hard cap on how many new comments a single campaign can enqueue per sweep, so
// a viral post drains gradually instead of bursting into the comment API.
const MAX_NEW_PER_SWEEP = Number(process.env.COMMENT_POLL_MAX_PER_SWEEP ?? 30);
// For "any post" campaigns, how many recent posts to scan.
//
// This is the OTHER half of the sweep's reach, and at a normal posting rate it is
// usually the binding one: LOOKBACK_HOURS and this cap are ANDed, so the sweep
// sees "comments inside the window, on the last N posts", whichever is narrower.
// An account posting twice a day gets ~2.5 days of reach out of a 10-post cap no
// matter how wide the hour window is set — which makes COMMENT_POLL_LOOKBACK_HOURS
// look broken when it is merely outranked.
const RECENT_MEDIA_LIMIT = Number(process.env.COMMENT_POLL_MEDIA_LIMIT ?? 10);

const MS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;

/**
 * When and how a sweep hands a fresh matching comment to the queue. The live
 * poll sends every comment immediately with the public reply intact; the
 * lookback delays each to its same-time-of-day slot and sends the DM only.
 */
interface EnqueuePlan {
  /** Attribution tag written to the job's `source`. */
  source: CommentSource;
  /** Skip the public comment reply (true for a days-old lookback lead). */
  suppressPublicReply: boolean;
  /**
   * BullMQ delay (ms) for a comment given its platform timestamp and the sweep
   * clock, or null to skip it as unreachable (outside the window).
   */
  scheduleFor(commentTimestamp: string, nowMs: number): number | null;
}

/** Everything a single sweep needs beyond the campaign row itself. */
interface SweepConfig {
  sinceMs: number;
  nowMs: number;
  mediaLimit: number;
  maxPerSweep: number;
  plan: EnqueuePlan;
}

const LIVE_PLAN: EnqueuePlan = {
  source: "POLLING",
  suppressPublicReply: false,
  scheduleFor: () => 0,
};

interface CampaignRow {
  id: string;
  name: string;
  postId: string | null;
  matchAnyPost: boolean;
  matchAnyWord: boolean;
  keywords: string[];
  wholeWordMatch: boolean;
  publicReplyEnabled: boolean;
  workspaceId: string;
  socialAccount: {
    id: string;
    platform: SocialPlatform;
    externalId: string;
    username: string;
    accessToken: string;
  };
}

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  postId: true,
  matchAnyPost: true,
  matchAnyWord: true,
  keywords: true,
  wholeWordMatch: true,
  publicReplyEnabled: true,
  workspaceId: true,
  socialAccount: {
    select: {
      id: true,
      platform: true,
      externalId: true,
      username: true,
      accessToken: true,
    },
  },
} as const;

interface SweepStat {
  campaign: string;
  keywords: string;
  matched: number;
  alreadyReplied: number;
  enqueued: number;
  /** Matched leads skipped because they are outside the messaging window. */
  unreachable: number;
  errors: string[];
}

function errMessage(error: unknown): string {
  if (error instanceof MetaApiError) return `Meta ${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

/** One reconciliation pass across every active campaign (the live poll). */
export async function reconcileComments(): Promise<void> {
  const automations = await prisma.automation.findMany({
    where: { isActive: true },
    select: CAMPAIGN_SELECT,
  });

  const nowMs = Date.now();
  const cfg: SweepConfig = {
    sinceMs: nowMs - LOOKBACK_HOURS * MS_PER_HOUR,
    nowMs,
    mediaLimit: RECENT_MEDIA_LIMIT,
    maxPerSweep: MAX_NEW_PER_SWEEP,
    plan: LIVE_PLAN,
  };

  await runSweeps(automations, cfg);
}

export interface LookbackSummary {
  campaigns: number;
  matched: number;
  alreadyReplied: number;
  enqueued: number;
  unreachable: number;
  errors: number;
}

export interface LookbackOptions {
  /** Private-reply window length in days. Default 7. */
  windowDays?: number;
  /** Safety margin before the hard window edge, ms. Default 2h. */
  marginMs?: number;
  /** Policy for a lead whose only in-window time is its final day. Default "immediate". */
  finalDay?: "immediate" | "skip";
  /** Recent posts to scan for any-post campaigns. Default COMMENT_POLL_MEDIA_LIMIT. */
  mediaLimit?: number;
  /** Max comments to enqueue per campaign per pass. Default COMMENT_POLL_MAX_PER_SWEEP. */
  maxPerSweep?: number;
  /**
   * Suppress the public comment reply, sending the DM only. Default true: a
   * public reply on a days-old comment reads as conspicuously late. Set false to
   * also post the reply (the campaign must still have publicReplyEnabled).
   */
  suppressPublicReply?: boolean;
}

/**
 * One-off Facebook backlog pass: DM leads whose comments never got one. Each is
 * scheduled for the same UTC time-of-day it was left (the recipient's original
 * active local hour — see `planLookbackSend`) and only while inside Meta's
 * private-reply window; the public reply is suppressed by default. Facebook-only: the
 * Instagram live sweep already covers Instagram, and this backfill is scoped to
 * the channel just deployed.
 */
export async function runLookback(
  opts: LookbackOptions = {}
): Promise<LookbackSummary> {
  const windowDays = opts.windowDays ?? 7;
  const nowMs = Date.now();

  const cfg: SweepConfig = {
    sinceMs: nowMs - windowDays * HOURS_PER_DAY * MS_PER_HOUR,
    nowMs,
    mediaLimit: opts.mediaLimit ?? RECENT_MEDIA_LIMIT,
    maxPerSweep: opts.maxPerSweep ?? MAX_NEW_PER_SWEEP,
    plan: {
      source: "POLLING",
      suppressPublicReply: opts.suppressPublicReply ?? true,
      scheduleFor: (timestamp, at) => {
        const commentedAtMs = Date.parse(timestamp);
        if (!Number.isFinite(commentedAtMs)) return null;
        const decision = planLookbackSend({
          commentedAtMs,
          nowMs: at,
          windowDays,
          marginMs: opts.marginMs,
          finalDay: opts.finalDay,
        });
        return decision.reachable ? decision.delayMs : null;
      },
    },
  };

  const automations = await prisma.automation.findMany({
    where: { isActive: true, socialAccount: { platform: "FACEBOOK" } },
    select: CAMPAIGN_SELECT,
  });

  const stats = await runSweeps(automations, cfg);
  return summarize(stats);
}

function summarize(stats: SweepStat[]): LookbackSummary {
  return {
    campaigns: stats.length,
    matched: sumBy(stats, (s) => s.matched),
    alreadyReplied: sumBy(stats, (s) => s.alreadyReplied),
    enqueued: sumBy(stats, (s) => s.enqueued),
    unreachable: sumBy(stats, (s) => s.unreachable),
    errors: sumBy(stats, (s) => s.errors.length),
  };
}

function sumBy(stats: SweepStat[], pick: (s: SweepStat) => number): number {
  return stats.reduce((total, s) => total + pick(s), 0);
}

async function runSweeps(
  automations: CampaignRow[],
  cfg: SweepConfig
): Promise<SweepStat[]> {
  const tokenCache = new Map<string, string | null>();
  const stats: SweepStat[] = [];
  for (const automation of automations) {
    const stat = await sweepCampaign(automation, cfg, tokenCache).catch(
      (error): SweepStat => ({
        campaign: automation.name,
        keywords: automation.keywords.join(","),
        matched: 0,
        alreadyReplied: 0,
        enqueued: 0,
        unreachable: 0,
        errors: [errMessage(error)],
      })
    );
    await recordSweep(automation.workspaceId, stat);
    stats.push(stat);
  }
  return stats;
}

async function sweepCampaign(
  automation: CampaignRow,
  cfg: SweepConfig,
  tokenCache: Map<string, string | null>
): Promise<SweepStat> {
  const account = automation.socialAccount;
  const provider = resolveChannel(account.platform);
  const stat: SweepStat = {
    campaign: automation.name,
    keywords: automation.matchAnyWord
      ? "(any word)"
      : automation.keywords.join(","),
    matched: 0,
    alreadyReplied: 0,
    enqueued: 0,
    unreachable: 0,
    errors: [],
  };

  // Decrypt the account token once per sweep.
  let accessToken = tokenCache.get(account.id);
  if (accessToken === undefined) {
    try {
      accessToken = decryptToken(account.accessToken);
    } catch {
      accessToken = null;
    }
    tokenCache.set(account.id, accessToken);
  }
  if (!accessToken) {
    stat.errors.push("Failed to decrypt access token");
    return stat;
  }

  // Which media this campaign covers: its own post, or the recent feed if it
  // matches any post.
  const mediaIds: string[] = [];
  if (automation.postId) {
    mediaIds.push(automation.postId);
  } else if (automation.matchAnyPost) {
    try {
      const posts = await provider.listPosts({
        accessToken,
        max: cfg.mediaLimit,
      });
      mediaIds.push(...posts.map((p) => p.id));
    } catch (error) {
      stat.errors.push(`Media list: ${errMessage(error)}`);
    }
  }
  if (mediaIds.length === 0) return stat;

  const queue = getDMQueue();

  for (const mediaId of mediaIds) {
    let comments: ChannelComment[];
    try {
      comments = await provider.getRecentComments({
        accessToken,
        mediaId,
        sinceMs: cfg.sinceMs,
        ownerId: account.externalId,
      });
    } catch (error) {
      stat.errors.push(`Comments ${mediaId}: ${errMessage(error)}`);
      continue;
    }

    // Keep only comments that (a) aren't the account's own, (b) match the
    // keyword, and (c) have no reply from the account owner yet.
    const needsAction = comments.filter((c) => {
      if (!c.authorId || c.authorId === account.externalId) return false;

      const matched = automation.matchAnyWord
        ? true
        : matchKeywords(c.text ?? "", automation.keywords, automation.wholeWordMatch)
            .matched;
      if (!matched) return false;
      stat.matched += 1;

      if (c.ownerReplied) {
        stat.alreadyReplied += 1;
        return false;
      }
      return true;
    });
    if (needsAction.length === 0) continue;

    // Second guard against races: skip comments this campaign has already fully
    // handled. "Fully handled" depends on the campaign: if it posts a public
    // reply, the completion signal is publicReplySentAt (a DM alone is not
    // enough — the reply still has to land); otherwise a SENT DM is enough. This
    // is what lets a comment whose DM sent but whose public reply failed come
    // back and retry the reply.
    const handled = await prisma.dmLog.findMany({
      where: {
        automationId: automation.id,
        commentId: { in: needsAction.map((c) => c.id) },
        ...(automation.publicReplyEnabled
          ? { publicReplySentAt: { not: null } }
          : { status: "SENT" }),
      },
      select: { commentId: true },
    });
    const handledSet = new Set(handled.map((h) => h.commentId));

    // Oldest first, so whoever commented earliest gets answered first, capped.
    const fresh = needsAction
      .filter((c) => !handledSet.has(c.id))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .slice(0, cfg.maxPerSweep);

    for (const c of fresh) {
      const delayMs = cfg.plan.scheduleFor(c.timestamp, cfg.nowMs);
      if (delayMs === null) {
        stat.unreachable += 1;
        continue;
      }

      // No deterministic jobId here: a retained completed/failed job from an
      // earlier sweep would otherwise be treated as a duplicate and silently
      // drop this add, so the comment would never be retried. Dedup is handled
      // above (owner-reply + DmLog guards) and the worker is idempotent
      // (publicReplySentAt / SENT), so re-processing a comment is safe.
      await queue.add(
        "process-comment",
        {
          externalAccountId: account.externalId,
          platform: account.platform,
          commentId: c.id,
          commentText: c.text ?? "",
          commenterId: c.authorId,
          commenterName: c.authorName,
          mediaId,
          source: cfg.plan.source,
          commentedAt: c.timestamp,
          suppressPublicReply: cfg.plan.suppressPublicReply || undefined,
        },
        delayMs > 0 ? { delay: delayMs } : undefined
      );
      stat.enqueued += 1;
    }
  }

  return stat;
}

async function recordSweep(
  workspaceId: string,
  stat: SweepStat
): Promise<void> {
  // Only log when something happened or something went wrong.
  if (stat.enqueued === 0 && stat.unreachable === 0 && stat.errors.length === 0) {
    return;
  }

  await prisma.operationalEvent
    .create({
      data: {
        workspaceId,
        source: "SYSTEM",
        level: stat.errors.length > 0 ? "WARNING" : "INFO",
        message: `Comment sweep "${stat.campaign}" [${stat.keywords}]: ${stat.enqueued} enqueued, ${stat.matched} matched, ${stat.alreadyReplied} already replied, ${stat.unreachable} unreachable`,
        payload: { ...stat },
      },
    })
    .catch(() => {});
}
