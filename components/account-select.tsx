"use client";

import { useEffect, useRef, useState } from "react";
import type { SocialPlatform } from "@/app/generated/prisma/client";
import { PlatformBadge } from "@/components/platform-badge";

export interface AccountOption {
  id: string;
  username: string;
  externalId: string;
  name?: string | null;
  // Present once a caller supplies a multi-platform list; absent callers still
  // render an unbadged row, so this stays backward-compatible.
  platform?: SocialPlatform;
}

interface AccountSelectProps {
  accounts: AccountOption[];
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  label?: string;
}

const ALL_VALUE = "all";

export default function AccountSelect({
  accounts,
  value,
  onChange,
  includeAll = true,
  label = "Account",
}: AccountSelectProps) {
  // A native <select> can't render the PlatformBadge element inside <option>,
  // so this is a lightweight custom listbox that keeps the same value/onChange
  // contract and styling as the select it replaced.
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selected = accounts.find((account) => account.id === value);

  function select(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-w-52 items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">
            {selected ? `@${selected.username}` : includeAll ? "All accounts" : "Select account"}
          </span>
          {selected?.platform && <PlatformBadge platform={selected.platform} />}
        </span>
        <span aria-hidden className="shrink-0 text-zinc-500">
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          {includeAll && (
            <li role="option" aria-selected={value === ALL_VALUE}>
              <button
                type="button"
                onClick={() => select(ALL_VALUE)}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/5"
              >
                All accounts
              </button>
            </li>
          )}
          {accounts.map((account) => (
            <li key={account.id} role="option" aria-selected={account.id === value}>
              <button
                type="button"
                onClick={() => select(account.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/5"
              >
                <span className="truncate">@{account.username}</span>
                {account.platform && <PlatformBadge platform={account.platform} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
