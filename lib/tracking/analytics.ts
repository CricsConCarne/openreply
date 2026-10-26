import { postRef } from "./merge-codes";

const SKIPPED_PREFIX = "SKIPPED_";

export interface StatusCountRow {
  status: string;
  _count: number | { status?: number; _all?: number };
}

export interface KeywordCountRow {
  matchedKeyword: string | null;
  _count: number | { matchedKeyword?: number; _all?: number };
}

function getCount(value: StatusCountRow["_count"] | KeywordCountRow["_count"]) {
  if (typeof value === "number") return value;
  if ("status" in value && typeof value.status === "number") {
    return value.status;
  }
  if ("matchedKeyword" in value && typeof value.matchedKeyword === "number") {
    return value.matchedKeyword;
  }
  return value._all ?? 0;
}

export function calculateCtr(clicks: number, sent: number) {
  if (sent <= 0) return 0;
  // Raw clicks can exceed sends (repeat clicks, link-preview bots hitting the
  // tracked URL), which makes a "rate" over 100% — cap it so CTR stays sane.
  return Math.min(100, Number(((clicks / sent) * 100).toFixed(1)));
}

export function summarizeDmStatuses(rows: StatusCountRow[]) {
  return rows.reduce(
    (summary, row) => {
      const count = getCount(row._count);
      if (row.status === "SENT") summary.sent += count;
      if (row.status === "FAILED") summary.failed += count;
      if (row.status.startsWith(SKIPPED_PREFIX)) summary.skipped += count;
      return summary;
    },
    { sent: 0, skipped: 0, failed: 0 }
  );
}

export function normalizeTopKeywords(rows: KeywordCountRow[], limit = 5) {
  return rows
    .filter((row) => row.matchedKeyword)
    .map((row) => ({
      keyword: row.matchedKeyword as string,
      count: getCount(row._count),
    }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, limit);
}

export interface PostCountRow {
  mediaId: string | null;
  _count: { _all: number };
}

export interface PostBreakdown {
  mediaId: string;
  ref: string;
  dms: number;
  clicks: number;
}

/** DMs sent and link clicks per post: most DMs first, then most clicks. */
export function summarizeByPost(
  dmRows: PostCountRow[],
  clickRows: PostCountRow[]
): PostBreakdown[] {
  const byPost = new Map<string, PostBreakdown>();
  const rowFor = (mediaId: string) => {
    const existing = byPost.get(mediaId);
    if (existing) return existing;
    const created = { mediaId, ref: postRef(mediaId), dms: 0, clicks: 0 };
    byPost.set(mediaId, created);
    return created;
  };
  for (const row of dmRows) if (row.mediaId) rowFor(row.mediaId).dms += row._count._all;
  for (const row of clickRows) if (row.mediaId) rowFor(row.mediaId).clicks += row._count._all;
  return [...byPost.values()].sort((a, b) => b.dms - a.dms || b.clicks - a.clicks);
}
