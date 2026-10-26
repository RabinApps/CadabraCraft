import { useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { readingOrder, sectionOf } from "@cadabracraft/format";
import { BookOpen, Download, FileText, Menu, Minimize2, Maximize2, PanelRight, PenLine, Plus, Save, Settings as SettingsIcon } from "lucide-react";
import { Editor } from "../editor/Editor";
import { ReadingFooter } from "../editor/ReadingFooter";
import { ReadingSettings } from "../editor/ReadingSettings";
import { countWords } from "../lib/wordcount";
import { bridge } from "../lib/bridge";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { overlayClass, panelClass } from "../ui/Dialog";
import { Segmented } from "../ui/Segmented";
import { cx } from "../ui/cx";
import { Details } from "./Details";
import { ExportDialog, type ExportFormat } from "./ExportDialog";
import { Home } from "./Home";
import { HeaderMenu } from "./HeaderMenu";
import { ImportReportDialog } from "./ImportDialogs";
import { PrintPreview } from "./PrintPreview";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { Templates } from "./Templates";
import { useLayout } from "./layout";
import { useReading } from "./reading";
import { useRecents } from "./recents";
import { useProject } from "./store";

/** Full-page views. "book" is the editor (or Home when no project is open). */
type View = "book" | "settings" | "templates" | "print";

export function App() {
  const { t } = useLingui();
  const { manifest, currentId, currentDoc, draft, notice, reloadCount, actions } = useProject();
  const open = manifest !== null;
  const root = useProject((s) => s.root);
  const title = manifest?.title;
  const addRecent = useRecents((s) => s.add);
  // Any successful open, create or import lands here.
  useEffect(() => { if (root && title !== undefined) addRecent(root, title); }, [root, title, addRecent]);
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState<"write" | "read">("write");
  const [view, setView] = useState<View>("book");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("epub");
  const openExport = (format: ExportFormat) => { setExportFormat(format); setExportOpen(true); };
  const reading = useReading();
  const { focus: focusPref, details, set: setLayout } = useLayout();
  const reader = mode === "read";
  // Focus mode is for writing; reading mode already has its own bare layout.
  const focus = focusPref && !reader && open;
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape closes an open dialog or menu first. (The editor marks Escape as handled, so defaultPrevented is no signal.)
      if (e.key === "Escape" && !document.querySelector("[role=dialog], [role=menu]")) setLayout({ focus: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, setLayout]);
  useEffect(() => {
    if (!open) return;
    // Book-level undo/redo (chapter list edits): Mod+Alt+Z / Mod+Alt+Shift+Z. Mod+Z, Mod+Shift+Z and Mod+Y stay with the editor's text undo.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.code !== "KeyZ" || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      void (e.shiftKey ? actions.redo() : actions.undo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, actions]);
  const [words, setWords] = useState(0);
  useEffect(() => {
    // Count immediately for a freshly loaded chapter, but debounce while typing so large chapters stay responsive.
    if (!draft) { setWords(countWords(currentDoc)); return; }
    const timer = setTimeout(() => setWords(countWords(draft)), 250);
    return () => clearTimeout(timer);
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

  const backToBook = () => setView("book");
  if (view === "settings") return <Settings onBack={backToBook} />;
  if (manifest && view === "templates") return <Templates onBack={backToBook} />;
  if (manifest && view === "print") {
    return (
      <>
        <PrintPreview onBack={backToBook} onExport={openExport} />
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} format={exportFormat} onFormatChange={setExportFormat} />
      </>
    );
  }
  if (!manifest) {
    return (
      <>
      <Home
        error={error}
        onSettings={() => setView("settings")}
        pickFolder={bridge.pickFolder}
        pickImportSource={bridge.pickImportSource}
        onImport={actions.importBook}
        onCreate={(root, title, author) => run(() => actions.createProject(root, title, author))()}
        onOpenRecent={(r) => { setError(""); return actions.openProject(r).catch((e) => { setError(String(e instanceof Error ? e.message : e)); throw e; }); }}
        onOpen={run(async () => { const root = await bridge.pickFolder(); if (root) await actions.openProject(root); })}
      />
      <ImportReportDialog />
      </>
    );
  }
  const chapters = manifest.chapters;
  const pages = readingOrder(manifest);
  const index = pages.findIndex((c) => c.id === currentId);
  const section = currentId ? sectionOf(manifest, currentId) : null;
  const chapterNo = chapters.findIndex((c) => c.id === currentId) + 1;
  // Saving first means reading shows what was typed.
  const toRead = run(async () => { await actions.flush(); setMode("read"); });
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      {focus && <IconButton icon={Minimize2} label={t`Exit focus mode`} className="fixed end-3 top-3 z-10 bg-surface/80 backdrop-blur" onClick={() => setLayout({ focus: false })} />}
      {!focus && <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-2 py-2 md:px-4">
        <IconButton icon={Menu} label={t`Show chapters`} className="lg:hidden" onClick={() => setDrawer(true)} />
        <h1 className="min-w-0 truncate font-book text-base font-semibold">{manifest.title}</h1>
        <Badge tone={draft ? "warn" : "success"}>{draft ? t`Unsaved` : t`Saved`}</Badge>
        <span role="status" className="min-w-0 flex-1 truncate text-sm text-ink-muted max-sm:order-last max-sm:basis-full max-sm:px-2 max-sm:empty:hidden">{notice}</span>
        <Segmented
          label={t`Write or read`}
          value={mode}
          onChange={(m) => (m === "read" ? toRead() : setMode("write"))}
          items={[{ value: "write", label: t`Write`, icon: PenLine, collapse: true }, { value: "read", label: t`Read`, icon: BookOpen, collapse: true }]}
        />
        <div className="ms-auto flex items-center gap-2">
          {reader && <ReadingSettings />}
          {!reader && <IconButton icon={Maximize2} label={t`Focus mode`} onClick={() => setLayout({ focus: true })} />}
          {!reader && <IconButton icon={PanelRight} label={t`Details`} active={details} className="max-xl:hidden" onClick={() => setLayout({ details: !details })} />}
          {!reader && <Button icon={Save} className="max-sm:hidden" onClick={run(async () => { const d = useProject.getState().draft; if (d) await actions.saveCurrent(d); })}>{t`Save`}</Button>}
          <Button variant="primary" icon={Download} className="max-sm:hidden" onClick={run(async () => { await actions.flush(); openExport("epub"); })}>{t`Export`}</Button>
          <IconButton icon={SettingsIcon} label={t`Settings`} className="max-sm:hidden" onClick={() => setView("settings")} />
          <HeaderMenu
            label={t`More actions`}
            items={[
              ...(reader ? [] : [{ label: t`Save`, icon: Save, onSelect: run(async () => { const d = useProject.getState().draft; if (d) await actions.saveCurrent(d); }) }]),
              { label: t`Export`, icon: Download, onSelect: run(async () => { await actions.flush(); openExport("epub"); }) },
              { label: t`Settings`, icon: SettingsIcon, onSelect: () => setView("settings") },
            ]}
          />
        </div>
      </header>}
      <div className="flex min-h-0 flex-1">
        <aside className={cx("hidden w-[264px] shrink-0 overflow-y-auto bg-sidebar", focus ? "" : "lg:block")}>
          <Sidebar />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error && <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          {currentDoc && currentId ? (reader
            ? <Editor key={`${currentId}:read:${reloadCount}`} initial={currentDoc} language={manifest.language} reading={reading} />
            : <Editor key={`${currentId}:${reloadCount}`} initial={currentDoc} language={manifest.language} onChange={actions.setDraft} focus={focus} />) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-ink-muted">{pages.length ? t`Choose a chapter to start.` : t`This book has no chapters yet.`}</p>
              <Button variant="primary" icon={Plus} onClick={() => void actions.add(t`Chapter ${chapters.length + 1}`)}>{t`Add chapter`}</Button>
            </div>
          )}
          {index < 0 ? null : reader ? (
            <ReadingFooter index={index} pages={pages} chapterIds={chapters.map((c) => c.id)} onSelect={(id) => void actions.selectChapter(id)} />
          ) : (
            <footer className={cx("hidden shrink-0 items-center justify-between border-t border-border bg-surface px-4 py-1.5 text-xs text-ink-muted md:flex", focus && "md:hidden")}>
              <span>{section === "chapter" ? plural(words, { one: "# word in this chapter", other: "# words in this chapter" }) : plural(words, { one: "# word on this page", other: "# words on this page" })}</span>
              <span>{section === "front" ? t`Front matter` : section === "back" ? t`Back matter` : t`Chapter ${chapterNo} of ${chapters.length}`}</span>
            </footer>
          )}
        </main>
        {!focus && !reader && details && (
          <aside aria-label={t`Details`} className="hidden w-[280px] shrink-0 overflow-y-auto border-s border-border bg-surface xl:block">
            <Details manifest={manifest} pageTitle={pages[index]?.title ?? null} section={section} words={words} onChangeTemplate={() => setView("templates")} />
          </aside>
        )}
      </div>
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} format={exportFormat} onFormatChange={setExportFormat} onPreview={() => { setExportOpen(false); setView("print"); }} />
      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className={cx(overlayClass, "lg:hidden")} />
          <D.Content
            aria-describedby={undefined}
            className={cx(panelClass, "inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-sidebar lg:hidden", "md:inset-y-0 md:start-0 md:end-auto md:max-h-none md:w-80 md:rounded-none")}
          >
            <D.Title className="sr-only">{t`Chapters`}</D.Title>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
      <ImportReportDialog />
    </div>
  );
}
