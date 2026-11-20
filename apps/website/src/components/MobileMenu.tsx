"use client";

import { useEffect, useId, useRef, useState } from "react";

export type MenuLink = { href: string; label: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const row = "flex min-h-11 items-center rounded-md px-3 text-base text-ink-muted hover:bg-sidebar hover:text-ink";

/**
 * The header menu below the `lg` breakpoint: a toggle button and a full-width panel under the bar.
 * Escape, a click outside, focus leaving the menu and choosing a link close it; Escape returns focus to the toggle.
 * `cta` (the Download button) is only shown below `sm`, where the bar has no room for it.
 */
export function MobileMenu({ label, links, cta }: { label: string; links: MenuLink[]; cta: MenuLink }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  return (
    <div ref={root} className="lg:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center rounded-md border border-border bg-surface p-2 text-ink-muted hover:bg-sidebar hover:text-ink"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" {...stroke}>
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border bg-surface shadow-lg"
      >
        <ul className="mx-auto flex max-w-6xl flex-col gap-1 px-4 pb-4 pt-3 sm:px-6">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} onClick={() => setOpen(false)} className={row}>
                {l.label}
              </a>
            </li>
          ))}
          <li className="mt-2 sm:hidden">
            <a
              href={cta.href}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center justify-center rounded-md bg-accent px-4 font-medium text-accent-ink hover:opacity-90"
            >
              {cta.label}
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}
