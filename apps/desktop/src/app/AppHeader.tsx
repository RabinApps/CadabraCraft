import { useLingui } from "@lingui/react/macro";
import { BookOpen, Download, Maximize2, Menu, PanelRight, PenLine, Save, Settings as SettingsIcon } from "lucide-react";
import { ReadingSettings } from "../editor/ReadingSettings";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { HeaderMenu } from "./HeaderMenu";
import { useLayout } from "./layout";
import { useProject } from "./store";

interface Props {
  mode: "write" | "read";
  onMode: (mode: "write" | "read") => void;
  onShowChapters: () => void;
  onExport: () => void;
  onSettings: () => void;
  /** Runs an action, clearing the shown error first and showing its failure. */
  run: (f: () => Promise<void>) => () => void;
}

/** The top bar of an open book: title, save state, write/read switch and the main actions. */
export function AppHeader({ mode, onMode, onShowChapters, onExport, onSettings, run }: Props) {
  const { t } = useLingui();
  const title = useProject((s) => s.manifest?.title);
  const unsaved = useProject((s) => s.draft !== null);
  const notice = useProject((s) => s.notice);
  const actions = useProject((s) => s.actions);
  const { details, set: setLayout } = useLayout();
  const reader = mode === "read";
  const save = run(actions.flush);
  // Saving first means the export and the reader show what was typed.
  const exportBook = run(async () => { await actions.flush(); onExport(); });
  const toRead = run(async () => { await actions.flush(); onMode("read"); });
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-2 py-2 md:px-4">
      <IconButton icon={Menu} label={t`Show chapters`} className="lg:hidden" onClick={onShowChapters} />
      <h1 className="min-w-0 truncate font-book text-base font-semibold">{title}</h1>
      <Badge tone={unsaved ? "warn" : "success"}>{unsaved ? t`Unsaved` : t`Saved`}</Badge>
      <span role="status" className="min-w-0 flex-1 truncate text-sm text-ink-muted max-sm:order-last max-sm:basis-full max-sm:px-2 max-sm:empty:hidden">{notice}</span>
      <Segmented
        label={t`Write or read`}
        value={mode}
        onChange={(m) => (m === "read" ? toRead() : onMode("write"))}
        items={[{ value: "write", label: t`Write`, icon: PenLine, collapse: true }, { value: "read", label: t`Read`, icon: BookOpen, collapse: true }]}
      />
      <div className="ms-auto flex items-center gap-2">
        {reader && <ReadingSettings />}
        {!reader && <IconButton icon={Maximize2} label={t`Focus mode`} onClick={() => setLayout({ focus: true })} />}
        {!reader && <IconButton icon={PanelRight} label={t`Details`} active={details} className="max-xl:hidden" onClick={() => setLayout({ details: !details })} />}
        {!reader && <Button icon={Save} className="max-sm:hidden" onClick={save}>{t`Save`}</Button>}
        <Button variant="primary" icon={Download} className="max-sm:hidden" onClick={exportBook}>{t`Export`}</Button>
        <IconButton icon={SettingsIcon} label={t`Settings`} className="max-sm:hidden" onClick={onSettings} />
        <HeaderMenu
          label={t`More actions`}
          items={[
            ...(reader ? [] : [{ label: t`Save`, icon: Save, onSelect: save }]),
            { label: t`Export`, icon: Download, onSelect: exportBook },
            { label: t`Settings`, icon: SettingsIcon, onSelect: onSettings },
          ]}
        />
      </div>
    </header>
  );
}
