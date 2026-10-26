import { useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { BookOpen, Download, Menu, PenLine, Plus, Save } from "lucide-react";
import { Editor } from "../editor/Editor";
import { ReadingFooter } from "../editor/ReadingFooter";
import { ReadingSettings } from "../editor/ReadingSettings";
import { countWords } from "../lib/wordcount";
import { bridge } from "../lib/bridge";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { overlayClass, panelClass } from "../ui/Dialog";
import { Segmented } from "../ui/Segmented";
import { ThemeToggle } from "../ui/ThemeToggle";
import { cx } from "../ui/cx";
import { Home } from "./Home";
import { Sidebar } from "./Sidebar";
import { useReading } from "./reading";
import { useProject } from "./store";

export function App() {
  const { manifest, currentId, currentDoc, draft, notice, reloadCount, actions } = useProject();
  const open = manifest !== null;
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState<"write" | "read">("write");
  const reading = useReading();
  const [words, setWords] = useState(0);
  useEffect(() => {
    // Count immediately for a freshly loaded chapter, but debounce while typing so large chapters stay responsive.
    if (!draft) { setWords(countWords(currentDoc)); return; }
    const t = setTimeout(() => setWords(countWords(draft)), 250);
    return () => clearTimeout(t);
  }, [draft, currentDoc]);
  useEffect(() => {
    if (!open) return;
    const un = bridge.onProjectChanged((p) => void actions.externalChange(p));
    return () => void un.then((f) => f());
  }, [open, actions]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => { if (mq.matches) setDrawer(false); };
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);
  const [error, setError] = useState("");
  const run = (f: () => Promise<void>) => () => { setError(""); f().catch((e) => setError(String(e instanceof Error ? e.message : e))); };

  if (!manifest) {
    return (
      <Home
        error={error}
        pickFolder={bridge.pickFolder}
        onCreate={(root, title, author) => run(() => actions.createProject(root, title, author))()}
        onOpen={run(async () => { const root = await bridge.pickFolder(); if (root) await actions.openProject(root); })}
      />
    );
  }
  const chapters = manifest.chapters;
  const index = chapters.findIndex((c) => c.id === currentId);
  const reader = mode === "read";
  // Saving first means reading shows what was typed.
  const toRead = run(async () => { await actions.flush(); setMode("read"); });
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-2 py-2 md:px-4">
        <IconButton icon={Menu} label="Show chapters" className="lg:hidden" onClick={() => setDrawer(true)} />
        <h1 className="min-w-0 truncate font-book text-base font-semibold">{manifest.title}</h1>
        <Badge tone={draft ? "warn" : "success"}>{draft ? "Unsaved" : "Saved"}</Badge>
        <span role="status" className="min-w-0 flex-1 truncate text-sm text-ink-muted max-sm:order-last max-sm:basis-full max-sm:px-2 max-sm:empty:hidden">{notice}</span>
        <Segmented
          label="Write or read"
          value={mode}
          onChange={(m) => (m === "read" ? toRead() : setMode("write"))}
          items={[{ value: "write", label: "Write", icon: PenLine, collapse: true }, { value: "read", label: "Read", icon: BookOpen, collapse: true }]}
        />
        <div className="ml-auto flex items-center gap-2">
          {reader && <ReadingSettings />}
          <ThemeToggle />
          {!reader && <Button icon={Save} className="max-sm:px-3" onClick={run(async () => { const d = useProject.getState().draft; if (d) await actions.saveCurrent(d); })}><span className="max-sm:sr-only">Save</span></Button>}
          <Button variant="primary" icon={Download} className="max-sm:px-3" onClick={run(actions.exportEpub)}><span className="max-sm:sr-only">Export EPUB</span></Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[264px] shrink-0 overflow-y-auto bg-sidebar lg:block">
          <Sidebar />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error && <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          {currentDoc && currentId ? (reader
            ? <Editor key={`${currentId}:read:${reloadCount}`} initial={currentDoc} reading={reading} />
            : <Editor key={`${currentId}:${reloadCount}`} initial={currentDoc} onChange={actions.setDraft} />) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-ink-muted">{chapters.length ? "Choose a chapter to start." : "This book has no chapters yet."}</p>
              <Button variant="primary" icon={Plus} onClick={() => void actions.add(`Chapter ${chapters.length + 1}`)}>Add chapter</Button>
            </div>
          )}
          {index < 0 ? null : reader ? (
            <ReadingFooter index={index} chapters={chapters} onSelect={(id) => void actions.selectChapter(id)} />
          ) : (
            <footer className="hidden shrink-0 items-center justify-between border-t border-border bg-surface px-4 py-1.5 text-xs text-ink-muted md:flex">
              <span>{words.toLocaleString()} words in this chapter</span>
              <span>Chapter {index + 1} of {chapters.length}</span>
            </footer>
          )}
        </main>
      </div>
      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className={cx(overlayClass, "lg:hidden")} />
          <D.Content
            aria-describedby={undefined}
            className={cx(panelClass, "inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-sidebar lg:hidden", "md:inset-y-0 md:left-0 md:right-auto md:max-h-none md:w-80 md:rounded-none")}
          >
            <D.Title className="sr-only">Chapters</D.Title>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
    </div>
  );
}
