import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { BookPlus, FolderOpen, HardDrive, Plus, WandSparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Dialog";
import { Field } from "../ui/Input";
import { LanguagePicker } from "../ui/LanguagePicker";
import { ThemeToggle } from "../ui/ThemeToggle";

interface Props {
  error: string;
  onOpen: () => void;
  pickFolder: () => Promise<string | null>;
  onCreate: (root: string, title: string, author: string) => void;
}

export function Home({ error, onOpen, pickFolder, onCreate }: Props) {
  const { t } = useLingui();
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center justify-between px-4 py-3.5 md:px-12">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-ink"><WandSparkles size={18} aria-hidden /></span>
          <span className="font-book text-xl font-semibold">CadabraCraft</span>
        </div>
        <div className="flex items-center gap-2"><LanguagePicker /><ThemeToggle /></div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 pb-24 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-accent"><BookPlus size={28} aria-hidden /></span>
        <h1 className="font-book text-3xl font-semibold md:text-4xl">{t`Write your first book`}</h1>
        <p className="text-sm text-ink-muted">{t`Start a new folder, or open one you already have. Everything stays on this computer.`}</p>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{t`New project`}</Button>
          <Button icon={FolderOpen} onClick={onOpen}>{t`Open folder`}</Button>
        </div>
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <p className="mt-6 flex max-w-sm items-start gap-2.5 text-start text-[13px] leading-relaxed text-ink-muted">
          <HardDrive size={16} aria-hidden className="mt-0.5 shrink-0" />
          {t`Each book is a plain folder you own. Keep it in Dropbox, Google Drive or iCloud Drive to sync across devices.`}
        </p>
      </main>
      <NewProjectDialog open={creating} onOpenChange={setCreating} pickFolder={pickFolder} onCreate={onCreate} />
    </div>
  );
}

function NewProjectDialog({ open, onOpenChange, pickFolder, onCreate }: Pick<Props, "pickFolder" | "onCreate"> & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useLingui();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [root, setRoot] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");
  const ready = title.trim() !== "" && root !== null;
  const change = (o: boolean) => {
    if (!o) { setTitle(""); setAuthor(""); setRoot(null); setPickError(""); }
    onOpenChange(o);
  };
  return (
    <Modal open={open} onOpenChange={change} title={t`New book`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          const [bookTitle, bookAuthor, folder] = [title.trim(), author.trim() || t`Unknown`, root];
          change(false);
          onCreate(folder, bookTitle, bookAuthor);
        }}
      >
        <Field label={t`Title`} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <Field label={t`Author`} value={author} onChange={(e) => setAuthor(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-muted">{t`Location`}</span>
          <div className="flex gap-2">
            <input aria-label={t`Folder`} readOnly value={root ?? ""} placeholder={t`No folder chosen`} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted placeholder:text-ink-muted" />
            <Button icon={FolderOpen} onClick={() => { setPickError(""); pickFolder().then((r) => r && setRoot(r)).catch((e) => setPickError(String(e instanceof Error ? e.message : e))); }}>{t`Choose…`}</Button>
          </div>
          <p className="text-xs text-ink-muted">{t`The book is stored in this folder. Nothing leaves your computer.`}</p>
          {pickError && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{pickError}</p>}
        </div>
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => change(false)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary" icon={BookPlus} disabled={!ready}>{t`Create book`}</Button>
        </div>
      </form>
    </Modal>
  );
}
