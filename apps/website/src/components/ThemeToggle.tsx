"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const order: Theme[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {
      /* storage unavailable */
    }
  }, []);

  function cycle() {
    const next = order[(order.indexOf(theme) + 1) % order.length]!;
    setTheme(next);
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

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${theme}. Switch theme`}
      className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
    >
      Theme: {theme}
    </button>
  );
}
