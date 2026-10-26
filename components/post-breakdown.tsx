"use client";

/**
 * Campaign insights, per post: which reels the campaign's DMs and link clicks
 * came from. The ref column is the exact `utm_content` the `{post}` merge code
 * sends, so a row can be matched to GA4 and the signup attribution.
 */

import { useEffect, useState } from "react";
import type { PostBreakdown as PostRow } from "@/lib/tracking/analytics";

interface PostLabel {
  caption?: string;
  permalink?: string;
}

interface PostBreakdownProps {
  automationId: string;
  socialAccountId: string;
}

const POSTS_LOOKUP_LIMIT = 50;
const CAPTION_PREVIEW_LENGTH = 60;
const HEADER_CELL = "px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider";

export default function PostBreakdown({ automationId, socialAccountId }: PostBreakdownProps) {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [labels, setLabels] = useState<Map<string, PostLabel>>(new Map());

  useEffect(() => {
    let ignore = false;
    Promise.all([
      fetch(`/api/automations/posts?id=${automationId}`, { cache: "no-store" }).then((r) =>
        r.json()
      ),
      fetch(`/api/instagram/posts?socialAccountId=${socialAccountId}&limit=${POSTS_LOOKUP_LIMIT}`)
        .then((r) => r.json())
        .catch(() => ({ success: false })),
    ])
      .then(([breakdown, posts]) => {
        if (ignore) return;
        if (breakdown.success) setRows(breakdown.data);
        if (posts.success) setLabels(labelsById(posts.data));
      })
      .catch(() => {
        if (!ignore) setRows([]);
      });
    return () => {
      ignore = true;
    };
  }, [automationId, socialAccountId]);

  if (rows.length === 0) return null;

  return (
    <div className="panel rounded overflow-hidden">
      <h2 className="px-4 pt-4 text-sm font-semibold text-foreground">By post</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={HEADER_CELL}>Post</th>
              <th className={HEADER_CELL}>utm_content</th>
              <th className={HEADER_CELL}>DMs</th>
              <th className={HEADER_CELL}>Clicks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.mediaId}>
                <td className="px-4 py-3 max-w-[240px]">
                  <PostCell label={labels.get(row.mediaId)} mediaId={row.mediaId} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{row.ref}</td>
                <td className="px-4 py-3 text-foreground">{row.dms}</td>
                <td className="px-4 py-3 text-foreground">{row.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PostCell({ label, mediaId }: { label?: PostLabel; mediaId: string }) {
  const text = label?.caption?.slice(0, CAPTION_PREVIEW_LENGTH) || mediaId;
  if (!label?.permalink) return <span className="text-muted truncate block">{text}</span>;
  return (
    <a
      href={label.permalink}
      target="_blank"
      rel="noreferrer"
      className="text-accent hover:underline truncate block"
    >
      {text}
    </a>
  );
}

function labelsById(posts: ({ id: string } & PostLabel)[]): Map<string, PostLabel> {
  return new Map(posts.map((post) => [post.id, { caption: post.caption, permalink: post.permalink }]));
}
