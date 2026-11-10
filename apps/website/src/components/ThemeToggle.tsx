"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Theme = "system" | "light" | "dark";
const themes: Theme[] = ["system", "light", "dark"];

export type ThemeLabels = { label: string; system: string; light: string; dark: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const icons: Record<Theme, ReactNode> = {
  system: (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" {...stroke}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  light: (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" {...stroke}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
    </svg>
  ),
};

function apply(next: Theme) {
  try {
    if (next === "system") {
      localStorage.removeItem("theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("theme", next);
      document.documentElement.dataset.theme = next;
    }
  } catch {
    /* the choice just won't persist */
  }
}

/** Icon button that opens a small menu to choose System, Light or Dark. */
export function ThemeToggle({ labels }: { labels: ThemeLabels }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {
      /* storage unavailable */
    }
  }, []);

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
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${labels.label}: ${labels[theme]}`}
        title={labels.label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center rounded-md border border-border bg-surface p-2 text-ink-muted hover:text-ink"
      >
        {icons[theme]}
      </button>
      {open && (
        <ul
          id={menuId}
          aria-label={labels.label}
          className="absolute end-0 mt-2 flex gap-1 rounded-lg border border-border bg-surface p-1.5 shadow-lg"
        >
          {themes.map((t) => (
            <li key={t}>
              <button
                type="button"
                aria-pressed={theme === t}
                aria-label={labels[t]}
                title={labels[t]}
                onClick={() => choose(t)}
                className={`inline-flex rounded-md p-2 hover:bg-sidebar ${
                  theme === t ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink"
                }`}
              >
                {icons[t]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
