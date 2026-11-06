import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import * as M from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Link as LinkIcon, Plus, StickyNote, Upload } from "lucide-react";
import { attempt } from "../../../state/attempt";
import { useProject } from "../../../state/project/index";
import { menuContentClass, menuItemClass } from "../../../ui/Menu";
import { AddLinkDialog } from "./AddLinkDialog";
import { AddNoteDialog } from "./AddNoteDialog";

/** The panel's Add button: a menu of Add files, Add link and Add note, with the two dialogs they open. */
export function AddMenu() {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const [dialog, setDialog] = useState<"link" | "note" | null>(null);
  const item = (Icon: typeof Upload, label: string, onSelect: () => void) => (
    <M.Item className={menuItemClass("gap-2")} onSelect={onSelect}>
      <Icon size={14} aria-hidden className="text-ink-muted" />
      {label}
    </M.Item>
  );
  return (
    <>
      <M.Root>
        <M.Trigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:min-h-11"
          >
            <Plus size={14} aria-hidden />
            {t`Add`}
            <ChevronDown size={14} aria-hidden />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content align="end" className={menuContentClass("min-w-48")}>
            {item(Upload, t`Add files`, () => attempt(actions.addReferences()))}
            {item(LinkIcon, t`Add link`, () => setDialog("link"))}
            {item(StickyNote, t`Add note`, () => setDialog("note"))}
          </M.Content>
        </M.Portal>
      </M.Root>
      <AddLinkDialog open={dialog === "link"} onOpenChange={(o) => !o && setDialog(null)} />
      <AddNoteDialog open={dialog === "note"} onOpenChange={(o) => !o && setDialog(null)} />
    </>
  );
}
