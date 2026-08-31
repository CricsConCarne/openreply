"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
const TYPEAHEAD_RESET_MS = 500;

interface ListboxOption {
  value: string;
  label: string;
  search: string;
  platform?: SocialPlatform;
}

export default function AccountSelect({
  accounts,
  value,
  onChange,
  includeAll = true,
  label = "Account",
}: AccountSelectProps) {
  // A native <select> can't render the PlatformBadge element inside <option>,
  // so this is a lightweight custom listbox that keeps the same value/onChange
  // contract and styling as the select it replaced, plus the keyboard and
  // ARIA affordances the native control gave for free.
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: "", timer: 0 as ReturnType<typeof setTimeout> | 0 });

  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const options = useMemo<ListboxOption[]>(() => {
    const list: ListboxOption[] = [];
    if (includeAll) {
      list.push({ value: ALL_VALUE, label: "All accounts", search: "all accounts" });
    }
    for (const account of accounts) {
      list.push({
        value: account.id,
        label: `@${account.username}`,
        search: account.username.toLowerCase(),
        platform: account.platform,
      });
    }
    return list;
  }, [accounts, includeAll]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = accounts.find((account) => account.id === value);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Move focus into the list once it opens; the active option is seeded by the
  // open action so navigation starts on the current selection.
  useEffect(() => {
    if (open) listboxRef.current?.focus();
  }, [open]);

  function openList() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function toggleList() {
    if (open) setOpen(false);
    else openList();
  }

  function closeAndFocusTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectOption(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    closeAndFocusTrigger();
  }

  function moveActive(next: number) {
    const clamped = Math.max(0, Math.min(next, options.length - 1));
    setActiveIndex(clamped);
  }

  function runTypeahead(char: string) {
    clearTimeout(typeahead.current.timer);
    typeahead.current.buffer += char.toLowerCase();
    const buffer = typeahead.current.buffer;
    typeahead.current.timer = setTimeout(() => {
      typeahead.current.buffer = "";
    }, TYPEAHEAD_RESET_MS);

    const count = options.length;
    if (count === 0) return;
    // A fresh single keystroke advances past the current option so repeats
    // cycle; a continuing multi-char buffer keeps refining from where we are.
    const from = buffer.length === 1 ? activeIndex + 1 : activeIndex;
    for (let step = 0; step < count; step++) {
      const index = ((from < 0 ? 0 : from) + step) % count;
      if (options[index].search.startsWith(buffer)) {
        setActiveIndex(index);
        return;
      }
    }
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openList();
    }
  }

  function handleListboxKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(activeIndex + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveActive(activeIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        moveActive(0);
        return;
      case "End":
        event.preventDefault();
        moveActive(options.length - 1);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        selectOption(activeIndex);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeAndFocusTrigger();
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          runTypeahead(event.key);
        }
    }
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-2 text-sm">
      <span
        id={labelId}
        className="text-xs font-semibold uppercase tracking-wide text-zinc-500"
      >
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleList}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        aria-controls={open ? listboxId : undefined}
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
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={optionId(activeIndex)}
          onKeyDown={handleListboxKeyDown}
          className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg outline-none"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              onClick={() => selectOption(index)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors ${
                index === activeIndex ? "bg-accent/10" : "hover:bg-accent/5"
              }`}
            >
              <span className="truncate">{option.label}</span>
              {option.platform && <PlatformBadge platform={option.platform} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
