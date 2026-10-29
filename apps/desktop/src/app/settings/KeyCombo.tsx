import { spokenCombo, type Key } from "./shortcutList";

/** One combo as keycaps; a screen reader hears the spoken phrase ("Command Shift N"), not the symbols. */
export function KeyCombo({ keys }: { keys: Key[] }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={spokenCombo(keys)}>
      {keys.map((k, i) => (
        <kbd
          key={i}
          aria-hidden
          className="min-w-6 rounded-sm border border-border-strong bg-sidebar px-1.5 py-0.5 text-center font-sans text-xs font-semibold text-ink"
        >
          {k.label}
        </kbd>
      ))}
    </span>
  );
}
