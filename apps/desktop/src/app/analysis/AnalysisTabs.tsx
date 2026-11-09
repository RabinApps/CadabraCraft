import { useRef, type KeyboardEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { cx } from "../../ui/cx";
import type { Scope } from "./analysisScope";

interface Props {
  value: Scope;
  onChange: (scope: Scope) => void;
}

/**
 * The Book | Chapter tabs. A tablist in the WAI-ARIA pattern: the selected tab is the only one in the Tab order, and the
 * arrow keys (with Home and End) move between them and select them.
 */
export function AnalysisTabs({ value, onChange }: Props) {
  const { t } = useLingui();
  const refs = useRef<Record<Scope, HTMLButtonElement | null>>({ book: null, chapter: null });
  const tabs: { id: Scope; label: string }[] = [
    { id: "book", label: t`Book` },
    { id: "chapter", label: t`Chapter` },
  ];
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = tabs.findIndex((tab) => tab.id === value);
    const next: Record<string, number> = {
      ArrowRight: (at + 1) % tabs.length,
      ArrowLeft: (at + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const to = next[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const scope = tabs[to]!.id;
    onChange(scope);
    refs.current[scope]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t`Scope`}
      className="inline-flex gap-0.5 rounded-md border border-border-strong bg-bg p-[3px]"
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={`analysis-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls="analysis-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={onKeyDown}
            className={cx(
              "rounded-sm px-3 py-1.5 text-small font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent",
              selected && "bg-accent-soft text-accent",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
