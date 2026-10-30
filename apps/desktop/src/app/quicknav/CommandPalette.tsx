import { useCallback, useMemo } from "react";
import { i18n } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { useCommandRegistry, runCommand } from "../../state/commands";
import { useProject } from "../../state/project/index";
import { useRecents } from "../../state/recents";
import { useSettings } from "../../state/editorPrefs";
import { isMac } from "../../lib/platform";
import { buildMenuModel } from "../shell/menuModel";
import { comboFromAccelerator, keysFor } from "../settings/shortcutList";
import { paletteEntries, paletteResults } from "./quickNavModel";
import { QuickPicker, type PickerItem } from "./QuickPicker";

/**
 * Cmd/Ctrl+K. Lists every command of the menu (one source: `buildMenuModel`), with its shortcut, a tick for toggles that are on,
 * and greyed out when it cannot run right now. Choosing one closes the palette and then runs it, like the menu item would.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const registry = useCommandRegistry();
  const recents = useRecents((s) => s.recents);
  const history = useProject((s) => s.history);
  const mac = isMac();
  const shortcuts = useSettings((s) => s.shortcutOverrides);
  const undoLabel = history.undo.at(-1)?.label ?? null;
  const redoLabel = history.redo.at(-1)?.label ?? null;
  const entries = useMemo(
    () =>
      paletteEntries(
        buildMenuModel({ mac, commands: registry, recents, undoLabel, redoLabel, shortcuts }),
      ),
    // Labels come from the current language.
    [mac, registry, recents, undoLabel, redoLabel, shortcuts, i18n.locale],
  );
  const filter = useCallback(
    (query: string): PickerItem[] =>
      paletteResults(entries, query).map(({ entry, positions }) => ({
        id: entry.key,
        label: entry.label,
        positions,
        hint: entry.category,
        enabled: entry.enabled,
        ...(entry.checked === undefined ? {} : { checked: entry.checked }),
        ...(entry.accelerator
          ? { keys: [keysFor(comboFromAccelerator(entry.accelerator), mac)] }
          : {}),
      })),
    [entries, mac],
  );
  const choose = (item: PickerItem) => {
    const entry = entries.find((e) => e.key === item.id);
    onClose();
    // Let the dialog unmount first: commands refuse to run while a dialog is open.
    if (entry) setTimeout(() => runCommand(entry.id, entry.arg), 0);
  };
  return (
    <QuickPicker
      open
      onOpenChange={(open) => !open && onClose()}
      title={t`Command palette`}
      placeholder={t`Type a command`}
      filter={filter}
      empty={(q) => t`No command matches “${q}”.`}
      onChoose={choose}
    />
  );
}
