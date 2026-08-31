"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface PickablePage {
  id: string;
  name: string;
  category?: string;
  alreadyConnected: boolean;
}

/**
 * Shown after the OAuth callback lands on /settings?facebook=select_page.
 * Lists the viewer's Facebook Pages so they can attach one to the workspace.
 */
export function FacebookPagePicker() {
  const searchParams = useSearchParams();
  const isSelecting = searchParams.get("facebook") === "select_page";

  const [pages, setPages] = useState<PickablePage[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    if (!isSelecting) return;
    void loadPages(setPages, setLoadFailed);
  }, [isSelecting]);

  if (!isSelecting) return null;

  async function selectPage(pageId: string) {
    setSelecting(pageId);
    const response = await fetch("/api/facebook/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId }),
    });
    // POST always 303-redirects back to settings with a ?facebook= code.
    window.location.assign(response.redirected ? response.url : "/settings");
  }

  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="text-base font-semibold mb-1">Choose a Facebook Page</h2>
      <p className="text-xs text-muted mb-6">
        Connect the Page whose comments you want to automate.
      </p>

      {pages === null && !loadFailed && (
        <p className="text-sm text-muted">Loading your Pages…</p>
      )}

      {loadFailed && (
        <p className="text-sm text-error">
          Could not load your Facebook Pages. Try connecting again.
        </p>
      )}

      {pages !== null && pages.length === 0 && (
        <p className="text-sm text-muted">
          No Facebook Pages are available on this account. Create a Page or grant
          the app access to one, then connect again.
        </p>
      )}

      <div className="space-y-3">
        {pages?.map((page) => (
          <div
            key={page.id}
            className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-semibold text-foreground">{page.name}</p>
              <p className="mt-1 text-xs text-muted">
                {page.category ?? "Facebook Page"}
                {page.alreadyConnected ? " · Already connected" : ""}
              </p>
            </div>
            <button
              onClick={() => selectPage(page.id)}
              disabled={page.alreadyConnected || selecting === page.id}
              className="inline-flex items-center justify-center rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {selecting === page.id ? "Connecting…" : "Connect"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// GET returns JSON when the connect session is valid, or a redirect back to
// settings (guard or expired cookie). fetch follows the redirect, so a
// redirected response means "no picker" — forward the browser to the code it
// carries so FacebookConnectNotice can explain what happened.
async function loadPages(
  setPages: (pages: PickablePage[]) => void,
  setLoadFailed: (failed: boolean) => void
) {
  try {
    const response = await fetch("/api/facebook/pages");
    if (response.redirected) {
      window.location.assign(response.url);
      return;
    }
    const payload = await response.json();
    setPages(Array.isArray(payload.pages) ? payload.pages : []);
  } catch {
    setLoadFailed(true);
  }
}
