import { useLingui } from "@lingui/react/macro";
import type { LanguageRow } from "@cadabracraft/format";
import { useProject } from "../../../state/project/index";
import { attempt } from "../../../state/attempt";

/** The inline field that renames a row; Enter or blur saves, Escape cancels. */
export function RenameField({
  row,
  titleLabel,
  setEditing,
}: {
  row: LanguageRow;
  titleLabel: string;
  setEditing: (e: null) => void;
}) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  return (
    <input
      autoFocus
      aria-label={titleLabel}
      defaultValue={row.title}
      className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
      onBlur={(e) => {
        setEditing(null);
        // Escape cancels: closing the field can still blur it, which must not save.
        if (e.target.dataset.cancelled) return;
        if (!e.target.value.trim())
          useProject.setState({
            notice: t`A title cannot be empty, so the old title was kept.`,
          });
        else if (e.target.value !== row.title)
          attempt(actions.rename(row.id, e.target.value.trim()));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        // The field goes away either way; the row's menu button takes the focus so it is not dropped on the page.
        const menuButton = e.currentTarget
          .closest("li")
          ?.querySelector<HTMLElement>("[aria-haspopup=menu]");
        if (e.key === "Enter") e.currentTarget.blur();
        else {
          e.currentTarget.dataset.cancelled = "true";
          setEditing(null);
        }
        menuButton?.focus();
      }}
    />
  );
}
