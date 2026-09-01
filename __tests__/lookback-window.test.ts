import { describe, it, expect } from "vitest";
import { planLookbackSend } from "@/lib/scheduling/lookback-window";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// A concrete anchor: a comment left 2026-08-25 at 15:30:00 UTC.
const ANCHOR = Date.UTC(2026, 7, 25, 15, 30, 0);

describe("planLookbackSend", () => {
  it("schedules the next same-UTC-time-of-day slot for a mid-window lead", () => {
    // 3 days + 5h later: past today's 15:30, so the next slot is tomorrow 15:30.
    const now = ANCHOR + 3 * MS_PER_DAY + 5 * HOUR;
    const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now });

    expect(d.reachable).toBe(true);
    if (!d.reachable) return;
    expect(d.reason).toBe("active-hour-slot");
    expect(d.sendAtMs).toBe(ANCHOR + 4 * MS_PER_DAY);
    expect(d.delayMs).toBe(19 * HOUR);
  });

  it("preserves the comment's exact UTC time-of-day", () => {
    const now = ANCHOR + 2 * MS_PER_DAY + 9 * HOUR;
    const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now });

    expect(d.reachable).toBe(true);
    if (!d.reachable) return;
    // A whole number of days from the anchor ⇒ identical wall-clock UTC time.
    expect((d.sendAtMs - ANCHOR) % MS_PER_DAY).toBe(0);
    const at = new Date(d.sendAtMs);
    expect(at.getUTCHours()).toBe(15);
    expect(at.getUTCMinutes()).toBe(30);
  });

  it("sends immediately when now is exactly on a slot boundary", () => {
    const now = ANCHOR + 3 * MS_PER_DAY; // exactly 15:30 UTC, 3 days on
    const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now });

    expect(d.reachable).toBe(true);
    if (!d.reachable) return;
    expect(d.reason).toBe("active-hour-slot");
    expect(d.delayMs).toBe(0);
    expect(d.sendAtMs).toBe(now);
  });

  it("always schedules strictly inside the 7-day window", () => {
    for (let h = 1; h < 7 * 24; h += 1) {
      const now = ANCHOR + h * HOUR;
      const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now });
      if (d.reachable) {
        expect(d.sendAtMs).toBeLessThan(ANCHOR + 7 * MS_PER_DAY);
        expect(d.sendAtMs).toBeGreaterThanOrEqual(now);
      }
    }
  });

  it("falls back to an immediate send on the final day (default policy)", () => {
    // 6d20h old: the next 15:30 slot (day 7) lands past the margin-adjusted
    // deadline, so there is no active-hour slot left — send now instead.
    const now = ANCHOR + 6 * MS_PER_DAY + 20 * HOUR;
    const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now });

    expect(d.reachable).toBe(true);
    if (!d.reachable) return;
    expect(d.reason).toBe("final-day-immediate");
    expect(d.delayMs).toBe(0);
  });

  it("skips the final-day lead when finalDay is 'skip'", () => {
    const now = ANCHOR + 6 * MS_PER_DAY + 20 * HOUR;
    const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now, finalDay: "skip" });

    expect(d.reachable).toBe(false);
    if (d.reachable) return;
    expect(d.reason).toBe("no-active-slot");
  });

  it("reports a lead past the window (minus margin) as unreachable", () => {
    // Default margin is 2h, so the deadline is day7 minus 2h = 6d22h.
    const now = ANCHOR + 6 * MS_PER_DAY + 23 * HOUR;
    const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now });

    expect(d.reachable).toBe(false);
    if (d.reachable) return;
    expect(d.reason).toBe("window-expired");
  });

  it("honours a custom window length", () => {
    // With a 3-day window, a 3-day-old comment is already expired.
    const now = ANCHOR + 3 * MS_PER_DAY;
    const d = planLookbackSend({ commentedAtMs: ANCHOR, nowMs: now, windowDays: 3 });
    expect(d.reachable).toBe(false);
  });
});
