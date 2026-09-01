/**
 * Lookback send scheduling.
 *
 * A lookback DM answers a lead whose comment we never DM'd. Two rules govern
 * when it may be sent, and they happen to reinforce each other:
 *
 *  1. Meta's private-reply window: a comment can be privately replied to for
 *     only ~7 days. After that the send is rejected and the lead is
 *     unreachable — no message tag or human-agent path exists for a
 *     comment-only lead.
 *
 *  2. Don't DM during the recipient's night. We cannot know their timezone
 *     (Meta gates that for strangers), but their comment's `created_time` is a
 *     moment they were demonstrably awake. A fixed UTC instant maps to a fixed
 *     local wall-clock time, so replaying at the comment's UTC time-of-day
 *     reproduces that same local hour — no timezone lookup needed.
 *
 * The two align because the last same-time-of-day slot inside the window
 * (`commentedAt + 7d`) is the window edge itself: the earliest such slot at or
 * after "now" is therefore both at the lead's active hour and inside the
 * window, whenever one exists at all.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MARGIN_MS = 2 * 60 * 60 * 1000; // send this far before the hard edge

export interface LookbackPlanParams {
  /** The comment's original platform time (Meta `created_time`), epoch ms. */
  commentedAtMs: number;
  /** Current time, epoch ms. */
  nowMs: number;
  /** Private-reply window length in days. Default 7. */
  windowDays?: number;
  /** Safety margin before the hard window edge, ms, to absorb clock/queue skew. Default 2h. */
  marginMs?: number;
  /**
   * What to do for a lead whose only remaining in-window time is its final day,
   * where no same-time-of-day (active-hour) slot fits before the deadline:
   * "immediate" sends now — reaching the lead, at the cost of a possibly
   * off-hour DM; "skip" leaves them unreached to protect their night.
   * Default "immediate".
   */
  finalDay?: "immediate" | "skip";
}

export type LookbackDecision =
  | {
      reachable: true;
      /** When to send, epoch ms. */
      sendAtMs: number;
      /** BullMQ delay to use at enqueue, ms (never negative). */
      delayMs: number;
      reason: "active-hour-slot" | "final-day-immediate";
    }
  | {
      reachable: false;
      reason: "window-expired" | "no-active-slot";
    };

/**
 * Decide whether and when to send a lookback DM for one comment. Pure — takes
 * `nowMs` rather than reading the clock, so it is deterministic and testable.
 */
export function planLookbackSend(p: LookbackPlanParams): LookbackDecision {
  const windowDays = p.windowDays ?? DEFAULT_WINDOW_DAYS;
  const marginMs = p.marginMs ?? DEFAULT_MARGIN_MS;
  const finalDay = p.finalDay ?? "immediate";

  const sendDeadlineMs = p.commentedAtMs + windowDays * MS_PER_DAY - marginMs;
  if (p.nowMs >= sendDeadlineMs) {
    return { reachable: false, reason: "window-expired" };
  }

  const slotMs = nextSameTimeOfDaySlot(p.commentedAtMs, p.nowMs);
  if (slotMs <= sendDeadlineMs) {
    return {
      reachable: true,
      sendAtMs: slotMs,
      delayMs: Math.max(0, slotMs - p.nowMs),
      reason: "active-hour-slot",
    };
  }

  if (finalDay === "skip") {
    return { reachable: false, reason: "no-active-slot" };
  }
  return { reachable: true, sendAtMs: p.nowMs, delayMs: 0, reason: "final-day-immediate" };
}

/**
 * The earliest instant at or after `nowMs` sharing `anchorMs`'s UTC time-of-day.
 * Uses whole-day (fixed-ms) steps, so the returned instant differs from the
 * anchor by an exact number of days and thus carries the identical UTC
 * hour:minute:second.
 */
function nextSameTimeOfDaySlot(anchorMs: number, nowMs: number): number {
  if (nowMs <= anchorMs) return anchorMs;
  const daysAhead = Math.ceil((nowMs - anchorMs) / MS_PER_DAY);
  return anchorMs + daysAhead * MS_PER_DAY;
}
