import { useEffect, useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/forms/Input";
import { isMac } from "../../lib/platform";
import { captureKey, comboProblem, MODIFIER_KEYS } from "../../lib/shortcutCombo";
import { setCapturingKeys } from "../../state/app/commands";
import { useSettings } from "../../state/view/editorPrefs";
import { applyOverrides, findConflict, withBinding, withoutBinding } from "./shortcutBindings";
import { buildShortcuts, groupRows, shortcutRows, type ShortcutRow } from "./shortcutList";
import { KeyCombo } from "./KeyCombo";

/** While `active`, every key goes to `onKey` and nowhere else (not to the editor, not to the app's commands). */
function useKeyCapture(active: boolean, onKey: (e: KeyboardEvent) => void) {
  useEffect(() => {
    if (!active) return;
    setCapturingKeys(true);
    const listener = (e: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onKey(e);
    };
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
      setCapturingKeys(false);
    };
  }, [active, onKey]);
}

/** One row of the list: the action, its keys, and the Change / Reset buttons for the ones that can be rebound. */
function ShortcutItem({
  row: r,
  waiting,
  problem,
  overridden,
  onChange,
  onReset,
}: {
  row: ShortcutRow;
  waiting: boolean;
  problem: string | null;
  overridden: boolean;
  onChange: () => void;
  onReset: () => void;
}) {
  const { t } = useLingui();
  const action = r.action;
  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0">{r.action}</span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {waiting ? (
            <span className="text-ink-muted">{t`Press the new keys…`}</span>
          ) : r.combos.length === 0 ? (
            <span className="text-ink-muted">{t`No key`}</span>
          ) : (
            r.combos.map((keys, i) => <KeyCombo key={i} keys={keys} />)
          )}
          {r.rebindable && (
            <>
              <Button
                size="sm"
                variant="ghost"
                id={`shortcut-change-${r.id}`}
                aria-label={t`Change shortcut for ${action}`}
                aria-pressed={waiting}
                aria-describedby={waiting && problem ? `shortcut-problem-${r.id}` : undefined}
                onClick={onChange}
              >
                {t`Change`}
              </Button>
              {overridden && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t`Reset shortcut for ${action}`}
                  onClick={onReset}
                >
                  {t`Reset`}
                </Button>
              )}
            </>
          )}
        </span>
      </div>
      {waiting && problem && (
        <p id={`shortcut-problem-${r.id}`} role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

/** The search box and the "Reset all" button above the list. */
function ShortcutsToolbar({
  query,
  onQuery,
  canReset,
  onResetAll,
}: {
  query: string;
  onQuery: (q: string) => void;
  canReset: boolean;
  onResetAll: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <Field
          label={t`Search shortcuts`}
          hideLabel
          type="search"
          placeholder={t`Search by action or key`}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <Button size="sm" disabled={!canReset} onClick={onResetAll}>
        {t`Reset all`}
      </Button>
    </div>
  );
}

/** The heading and the one-line help under it. */
function ShortcutsIntro({ title, mac }: { title: string; mac: boolean }) {
  const { t } = useLingui();
  return (
    <>
      <h2 id="shortcuts-heading" className="font-book text-title font-semibold">
        {title}
      </h2>
      <p className="text-xs text-ink-muted">
        {mac
          ? t`Choose Change, then press the new keys. Esc cancels and Backspace removes the key. ⌘ is Command, ⌥ is Option.`
          : t`Choose Change, then press the new keys. Esc cancels and Backspace removes the key. Ctrl is Control.`}
      </p>
    </>
  );
}

/**
 * Settings > Shortcuts: every key the app answers to, searchable by action or by key. "Change" on a row waits for the new keys
 * (Esc cancels, Backspace removes the key), "Reset" puts one back and "Reset all" puts them all back. Keys that belong to the
 * system or to the structure of the text (Undo, Copy, Tab, Enter...) are listed but fixed. Changes are kept in the app
 * preferences, not in the book.
 */
export function ShortcutsSection({ title }: { title: string }) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Spoken through a polite live region; the visible text stays as it is.
  const [announcement, setAnnouncement] = useState("");
  const overrides = useSettings((s) => s.shortcutOverrides);
  const set = useSettings((s) => s.set);
  const mac = isMac();
  // Rebuilt when the language changes (the labels come from the active catalog) or a key changes.
  const list = useMemo(() => applyOverrides(buildShortcuts(), overrides), [overrides, title]);
  const rows = useMemo(() => shortcutRows(list, mac), [list, mac]);
  const groups = groupRows(rows, query);
  const changed = Object.keys(overrides).length > 0;

  const stop = () => {
    setRecording(null);
    setProblem(null);
  };
  const actionOf = (id: string) => rows.find((r) => r.id === id)?.action ?? "";
  const save = (id: string, combo: string | null) => {
    const action = actionOf(id);
    set({ shortcutOverrides: withBinding(overrides, id, combo) });
    stop();
    setAnnouncement(
      combo === null ? t`Shortcut for ${action} removed.` : t`Shortcut for ${action} saved.`,
    );
  };
  const onKey = (e: KeyboardEvent) => {
    if (recording === null) return;
    const key = captureKey(e);
    if (key.kind === "ignore") return;
    if (key.kind === "cancel") {
      const action = actionOf(recording);
      stop();
      return setAnnouncement(t`Cancelled. Shortcut for ${action} unchanged.`);
    }
    if (key.kind === "clear") return save(recording, null);
    if (key.kind === "none") return setProblem(t`That key cannot be used. Press another one.`);
    if (comboProblem(key.combo))
      return setProblem(
        mac ? t`Hold ⌘ or ⌥ together with the key.` : t`Hold Ctrl or Alt together with the key.`,
      );
    const conflict = findConflict(list, recording, key.combo, mac);
    if (!conflict) return save(recording, key.combo);
    const owner = conflict.kind === "shortcut" ? conflict.action : "";
    setProblem(
      conflict.kind === "shortcut"
        ? t`Already used by “${owner}”. Press another key.`
        : t`The system or the text keeps this key. Press another one.`,
    );
  };
  useKeyCapture(recording !== null, onKey);

  return (
    <>
      <div id="shortcuts-live" role="status" className="sr-only">
        {announcement}
      </div>
      <section
        id="shortcuts"
        aria-labelledby="shortcuts-heading"
        className="flex scroll-mt-4 flex-col gap-3"
      >
        <ShortcutsIntro title={title} mac={mac} />
        <ShortcutsToolbar
          query={query}
          onQuery={setQuery}
          canReset={changed}
          onResetAll={() => {
            stop();
            set({ shortcutOverrides: {} });
            setAnnouncement(t`All shortcuts reset to default`);
          }}
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
                  <ShortcutItem
                    key={r.id}
                    row={r}
                    waiting={recording === r.id}
                    problem={problem}
                    overridden={Object.hasOwn(overrides, r.id)}
                    onChange={() => {
                      const waiting = recording === r.id;
                      const action = r.action;
                      setProblem(null);
                      setRecording(waiting ? null : r.id);
                      setAnnouncement(
                        waiting
                          ? t`Cancelled. Shortcut for ${action} unchanged.`
                          : t`Press the new keys for ${action}. Esc cancels.`,
                      );
                    }}
                    onReset={() => {
                      stop();
                      set({ shortcutOverrides: withoutBinding(overrides, r.id) });
                      setAnnouncement(t`Reset to default`);
                      // This button disappears once the key is back to default: keep focus on a stable one.
                      document.getElementById(`shortcut-change-${r.id}`)?.focus();
                    }}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
