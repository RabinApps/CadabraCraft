import { useState } from "react";
import { TRIM_SIZES, type TrimSize } from "@cadabracraft/export-pdf";
import { DEFAULT_TEMPLATE_ID, resolveTrimSize } from "@cadabracraft/templates";
import { useLingui } from "@lingui/react/macro";
import {
  BookPlus,
  FileUp,
  FolderOpen,
  HardDrive,
  Library as Library2,
  Plus,
  Settings,
} from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Field } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { trimLabel } from "../../lib/trimLabels";
import { useStartDialogs } from "../../state/commands";
import type { ImportChoices } from "../../lib/importBook";
import { ImportDialog } from "../dialogs/ImportDialogs";
import { newest, useRecents } from "../../state/recents";
import { useLibraryOpen } from "../../state/library";
import { Library } from "../library/Library";
import { useOpenBook } from "../library/useOpenBook";
import { whyText } from "../../lib/projectError";
import { Notice } from "../../ui/Notice";
import { BookCard, ContinueCard, NewBookTile } from "./Dashboard";

interface Props {
  error: string;
  onSettings: () => void;
  onOpen: () => void;
  onOpenRecent: (root: string) => Promise<void>;
  pickFolder: () => Promise<string | null>;
  onCreate: (root: string, title: string, author: string, trimSize: TrimSize) => void;
  pickImportSource: () => Promise<string | null>;
  onImport: (
    source: string,
    root: string,
    title: string,
    author: string,
    opts?: ImportChoices,
  ) => Promise<void>;
}

export function Home({
  error,
  onSettings,
  onOpen,
  onOpenRecent,
  pickFolder,
  onCreate,
  pickImportSource,
  onImport,
}: Props) {
  const { t } = useLingui();
  // Shared with the File menu, which can open these from inside a book too.
  const { creating, importing, setCreating, setImporting } = useStartDialogs();
  const { recents, remove } = useRecents();
  const libraryOpen = useLibraryOpen((l) => l.open);
  const setLibraryOpen = useLibraryOpen((l) => l.setOpen);
  // Folders that failed to open (moved, renamed or deleted) keep their entry so the user removes it deliberately.
  const { open: openRecent, problems: missing, forget } = useOpenBook(onOpenRecent);
  // Home lists the newest few books that were opened here; the Library lists them all, scanned ones included.
  const opened = newest(recents.filter((r) => r.openedAt > 0));
  const lead = opened[0];
  const showLibrary = libraryOpen && recents.length > 0;
  return (
    <>
      {showLibrary ? (
        <Library
          onBack={() => setLibraryOpen(false)}
          onOpenRecent={(r) => onOpenRecent(r).then(() => setLibraryOpen(false))}
        />
      ) : (
        <div className="flex min-h-dvh flex-col bg-bg text-ink">
          <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3.5 md:px-16">
            <div className="flex items-center gap-2.5">
              <img
                src="/brand/cadabracraft-icon.svg"
                alt=""
                width={32}
                height={32}
                className="size-8"
              />
              <span className="font-book text-title font-semibold">CadabraCraft</span>
            </div>
            <IconButton icon={Settings} label={t`Settings`} onClick={onSettings} />
          </header>
          {recents.length === 0 ? (
            <main
              id="main"
              tabIndex={-1}
              className="outline-none mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 pb-24 text-center"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-accent">
                <BookPlus size={28} aria-hidden />
              </span>
              <h1 className="font-book text-heading font-semibold md:text-display">{t`Write your first book`}</h1>
              <p className="text-sm text-ink-muted">{t`Start a new folder, or open one you already have. Everything stays on this computer.`}</p>
              <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
                <Button
                  variant="primary"
                  icon={Plus}
                  onClick={() => setCreating(true)}
                >{t`New project`}</Button>
                <Button icon={FolderOpen} onClick={onOpen}>{t`Open folder`}</Button>
                <Button icon={FileUp} onClick={() => setImporting(true)}>{t`Import…`}</Button>
              </div>
              {error && <Notice role="alert">{error}</Notice>}
              <p className="mt-6 flex max-w-sm items-start gap-2.5 text-start text-small leading-relaxed text-ink-muted">
                <HardDrive size={16} aria-hidden className="mt-0.5 shrink-0" />
                {t`Each book is a plain folder you own. Keep it in Dropbox, Google Drive or iCloud Drive to sync across devices.`}
              </p>
            </main>
          ) : (
            <main
              id="main"
              tabIndex={-1}
              className="outline-none mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 pb-10 md:px-16"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-col gap-1">
                  <h1 className="font-book text-heading font-semibold md:text-display">{t`Your books`}</h1>
                  <p className="text-sm text-ink-muted">{t`Stored on this computer. No account needed.`}</p>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <Button
                    variant="primary"
                    icon={Plus}
                    onClick={() => setCreating(true)}
                  >{t`New project`}</Button>
                  <Button icon={FolderOpen} onClick={onOpen}>{t`Open folder`}</Button>
                  <Button icon={FileUp} onClick={() => setImporting(true)}>{t`Import…`}</Button>
                </div>
              </div>
              {error && <Notice role="alert">{error}</Notice>}
              {lead && <ContinueCard recent={lead} onOpen={() => void openRecent(lead.root)} />}
              <section aria-label={t`Recent projects`} className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-subtitle font-semibold">{t`Recent`}</h2>
                  <Button icon={Library2} onClick={() => setLibraryOpen(true)}>
                    {t`View all books (${recents.length})`}
                  </Button>
                </div>
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {opened.map((r) => (
                    <BookCard
                      key={r.root}
                      recent={r}
                      problem={missing.get(r.root)}
                      onOpen={() => void openRecent(r.root)}
                      onRemove={() => {
                        remove(r.root);
                        forget(r.root);
                      }}
                    />
                  ))}
                  <NewBookTile onClick={() => setCreating(true)} />
                </ul>
              </section>
              <p className="mt-2 flex max-w-2xl items-start gap-2.5 text-start text-small leading-relaxed text-ink-muted">
                <HardDrive size={16} aria-hidden className="mt-0.5 shrink-0" />
                {t`Each book is a plain folder you own. Keep it in Dropbox, Google Drive or iCloud Drive to sync across devices.`}
              </p>
            </main>
          )}
        </div>
      )}
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        pickFolder={pickFolder}
        onCreate={onCreate}
      />
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        pickSource={pickImportSource}
        pickFolder={pickFolder}
        onImport={onImport}
      />
    </>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
  pickFolder,
  onCreate,
}: Pick<Props, "pickFolder" | "onCreate"> & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useLingui();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [trimSize, setTrimSize] = useState<TrimSize>(
    resolveTrimSize({ template: DEFAULT_TEMPLATE_ID }),
  );
  const [root, setRoot] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");
  const ready = title.trim() !== "" && root !== null;
  /** The dialog only ever closes from inside (it is opened from the store), so this resets the form and closes. */
  const change = () => {
    setTitle("");
    setAuthor("");
    setTrimSize(resolveTrimSize({ template: DEFAULT_TEMPLATE_ID }));
    setRoot(null);
    setPickError("");
    onOpenChange(false);
  };
  return (
    <Modal open={open} onOpenChange={change} title={t`New book`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          const [bookTitle, bookAuthor, folder] = [title.trim(), author.trim() || t`Unknown`, root];
          change();
          onCreate(folder, bookTitle, bookAuthor, trimSize);
        }}
      >
        <Field
          label={t`Title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <Field label={t`Author`} value={author} onChange={(e) => setAuthor(e.target.value)} />
        <Select
          label={t`Trim size`}
          className="h-10"
          value={trimSize}
          onChange={(e) => setTrimSize(e.target.value as TrimSize)}
          hint={t`Sets the page size for the print layout. You can change it later in Book details.`}
        >
          {(Object.keys(TRIM_SIZES) as TrimSize[]).map((id) => (
            <option key={id} value={id}>
              {trimLabel(id)}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-muted">{t`Location`}</span>
          <div className="flex gap-2">
            <input
              aria-label={t`Folder`}
              readOnly
              value={root ?? ""}
              placeholder={t`No folder chosen`}
              className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink-muted placeholder:text-ink-muted"
            />
            <Button
              icon={FolderOpen}
              onClick={() => {
                setPickError("");
                pickFolder()
                  .then((r) => r && setRoot(r))
                  .catch((e) => {
                    const why = whyText(e);
                    setPickError(t`Could not choose that folder: ${why}. Try again.`);
                  });
              }}
            >{t`Choose…`}</Button>
          </div>
          <p className="text-xs text-ink-muted">{t`The book is stored in this folder. Nothing leaves your computer.`}</p>
          {pickError && <Notice role="alert">{pickError}</Notice>}
        </div>
        <div className="flex justify-end gap-2.5">
          <Button onClick={change}>{t`Cancel`}</Button>
          <Button
            type="submit"
            variant="primary"
            icon={BookPlus}
            disabled={!ready}
          >{t`Create book`}</Button>
        </div>
      </form>
    </Modal>
  );
}
