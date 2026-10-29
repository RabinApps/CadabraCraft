import { useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Field } from "../../ui/Input";
import { isMac } from "../../lib/platform";
import { buildShortcuts, groupRows, shortcutRows } from "./shortcutList";
import { KeyCombo } from "./KeyCombo";

/** Settings > Shortcuts: every key the app answers to, searchable by action or by key. Read-only; keys are not rebindable. */
export function ShortcutsSection({ title }: { title: string }) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const mac = isMac();
  // Rebuilt when the language changes (the labels come from the active catalog).
  const rows = useMemo(() => shortcutRows(buildShortcuts(), mac), [mac, title]);
  const groups = groupRows(rows, query);
  return (
    <section
      id="shortcuts"
      aria-labelledby="shortcuts-heading"
      className="flex scroll-mt-4 flex-col gap-3"
    >
      <h2 id="shortcuts-heading" className="font-book text-title font-semibold">
        {title}
      </h2>
      <p className="text-xs text-ink-muted">
        {mac
          ? t`Keys cannot be changed yet. ⌘ is Command, ⌥ is Option.`
          : t`Keys cannot be changed yet. Ctrl is Control.`}
      </p>
      <Field
        label={t`Search shortcuts`}
        hideLabel
        type="search"
        placeholder={t`Search by action or key`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.length === 0 ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-ink-muted"
        >
          {t`No shortcut matches “${query.trim()}”.`}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.group} className="flex flex-col gap-1.5">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {g.label}
            </h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
              {g.rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0">{r.action}</span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
                    {r.combos.map((keys, i) => (
                      <KeyCombo key={i} keys={keys} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
