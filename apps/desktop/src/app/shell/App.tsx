import { useCallback, useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  readingOrder,
  sectionOf,
  sourceEdition,
  entryRows,
  entryRowsIn,
} from "@cadabracraft/format";
import { Minimize2, Plus } from "lucide-react";
import { Editor } from "../../editor/Editor";
import { TocEditor } from "../toc/TocEditor";
import { ReadingBook } from "../../editor/ReadingBook";
import { ReadingFooter } from "../../editor/ReadingFooter";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import { StatusBar } from "./StatusBar";
import { Button, IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Details } from "./Details";
import { ReferencesPanel } from "../references/ReferencesPanel";
import { ReferenceViewer } from "../references/ReferenceViewer";
import { BookDetailsDialog } from "../dialogs/BookDetailsDialog";
import { ExportDialog } from "../export/ExportDialog";
import type { ExportFormat } from "../export/exportFormat";
import { Home } from "../home/Home";
import { AppHeader } from "./AppHeader";
import { ImportDialog, ImportReportDialog } from "../dialogs/ImportDialogs";
import { useStartDialogs } from "../../state/commands";
import { PrintPreview } from "../export/PrintPreview";
import { Settings } from "../settings/Settings";
import { useWindowTitle } from "../hooks/useWindowTitle";
import { SponsorDialog } from "../dialogs/SponsorDialog";
import { LicensesDialog } from "../dialogs/LicensesDialog";
import { UpdateDialog } from "../dialogs/UpdateDialog";
import { RecoverDialog } from "../dialogs/RecoverDialog";
import { useUpdates } from "../../state/updates";
import { Sidebar } from "./Sidebar";
import { ChaptersDrawer, ReferencesSheet } from "./Drawers";
import { QuickNav } from "../quicknav/QuickNav";
import { OpeningSkeleton } from "./OpeningSkeleton";
import { Templates } from "../export/Templates";
import { useLayout } from "../../state/layout";
import { useReadingPosition } from "../../state/readingPosition";
import { useRecents } from "../../state/recents";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import { useAppMenu } from "../hooks/useAppMenu";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useSaveOnClose } from "../hooks/useSaveOnClose";
import { useWordCount } from "../hooks/useWordCount";
import { useBookWordCount } from "../hooks/useBookWordCount";
import { useSessionWords } from "../hooks/useSessionWords";
import { useSettings } from "../../state/editorPrefs";
import { LG_QUERY } from "./breakpoints";
import { Notice } from "../../ui/Notice";
import { useViewMode } from "../../state/viewMode";

/** Full-page views. "book" is the editor (or Home when no project is open). */
/** `fonts` is Settings scrolled to Fonts (from the "font missing" notice in the export dialog). */
type View = "book" | "settings" | "fonts" | "templates" | "print";

/** The app and, above every screen, the command palette and the outline navigator. */
export function App() {
  return (
    <>
      <AppScreens />
      <QuickNav />
    </>
  );
}

function AppScreens() {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const activeLanguage = useProject(
    (s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "",
  );
  const currentId = useProject((s) => s.currentId);
  const currentDoc = useProject((s) => s.currentDoc);
  const readPosition = useReadingPosition();
  const reloadCount = useProject((s) => s.reloadCount);
  const actions = useProject((s) => s.actions);
  const opening = useProject((s) => s.opening);
  const open = manifest !== null;
  const root = useProject((s) => s.root);
  const title = manifest ? sourceEdition(manifest.editions).title : undefined;
  const addRecent = useRecents((s) => s.add);
  // Any successful open, create or import lands here.
  useEffect(() => {
    if (root && title !== undefined) addRecent(root, title);
  }, [root, title, addRecent]);
  const [drawer, setDrawer] = useState(false);
  const { mode, setMode } = useViewMode();
  const [view, setView] = useState<View>("book");
  useWindowTitle(
    view === "settings" || view === "fonts"
      ? t`Settings`
      : view === "templates"
        ? t`Templates`
        : view === "print"
          ? t`Print preview`
          : undefined,
    title,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [refsSheet, setRefsSheet] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("epub");
  const openExport = (format: ExportFormat) => {
    setExportFormat(format);
    setExportOpen(true);
  };
  const { focus: focusPref, details, references, set: setLayout } = useLayout();
  const reader = mode === "read";
  const { importingInto, setImportingInto } = useStartDialogs();
  // Focus mode is for writing; reading mode already has its own bare layout.
  const focus = focusPref && !reader && open;
  const exitFocus = useCallback(() => setLayout({ focus: false }), [setLayout]);
  useGlobalShortcuts({ open, focus, exitFocus });
  useSaveOnClose();
  const words = useWordCount();
  const bookWords = useBookWordCount();
  const setStats = useRecents((s) => s.setStats);
  // What the Home dashboard shows about this book, refreshed shortly after typing pauses.
  useEffect(() => {
    if (!root || !manifest || bookWords === null) return;
    const source = sourceEdition(manifest.editions);
    const rows = entryRows(manifest.chapters, manifest.editions);
    const at = rows.findIndex((r) => r.id === currentId);
    const stats = {
      author: source.author,
      chapters: rows.length,
      words: bookWords,
      chapterNo: at + 1,
      chapterTitle: rows[at]?.title ?? "",
    };
    const id = setTimeout(() => setStats(root, stats), 1000);
    return () => clearTimeout(id);
  }, [root, manifest, currentId, bookWords, setStats]);
  const sessionWritten = useSessionWords(root, activeLanguage, bookWords);
  const sessionGoal = useSettings((s) => s.sessionGoal);
  useEffect(() => {
    if (!open) return;
    const un = bridge.onProjectChanged((p) => attempt(actions.externalChange(p)));
    const failed = bridge.onProjectWatchError(() => actions.watchFailed());
    return () => {
      void un.then((f) => f());
      void failed.then((f) => f());
    };
  }, [open, actions]);
  useEffect(() => {
    if (import.meta.env.PROD) void useUpdates.getState().check(false);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia(LG_QUERY);
    const close = () => mq.matches && setDrawer(false);
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);
  const [error, setError] = useState("");
  const run = (f: () => Promise<void>) => () => {
    setError("");
    f().catch((e) => setError(errText(e)));
  };
  useAppMenu({
    view,
    setView,
    mode,
    setMode,
    openExport,
    openDetails: () => setDetailsOpen(true),
    fail: setError,
  });
  const backToBook = () => setView("book");
  const skeleton = opening && view === "book" ? <OpeningSkeleton name={opening.name} /> : null;
  if (skeleton && manifest) return skeleton;
  if (view === "settings" || view === "fonts") {
    return (
      <>
        <Settings onBack={backToBook} initialSection={view === "fonts" ? "fonts" : undefined} />
        <UpdateDialog />
        <LicensesDialog />
      </>
    );
  }
  if (manifest && view === "templates") return <Templates onBack={backToBook} />;
  if (manifest && view === "print") {
    return (
      <>
        <PrintPreview onBack={backToBook} onExport={openExport} />
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          format={exportFormat}
          onFormatChange={setExportFormat}
          onOpenFonts={() => setView("fonts")}
        />
        <SponsorDialog />
        <UpdateDialog />
        <LicensesDialog />
      </>
    );
  }
  if (!manifest) {
    return (
      <>
        {skeleton}
        {/* Home stays mounted (hidden) under the skeleton, so a failed open still marks its row. */}
        <div className="contents" hidden={skeleton !== null}>
          <Home
            error={error}
            onSettings={() => setView("settings")}
            pickFolder={bridge.pickFolder}
            pickImportSource={bridge.pickImportSource}
            onImport={actions.importBook}
            onCreate={(root, title, author, trimSize) =>
              run(() => actions.createProject(root, title, author, trimSize))()
            }
            onOpenRecent={(r) => {
              setError("");
              return actions.openProject(r).catch((e) => {
                setError(errText(e));
                throw e;
              });
            }}
            onOpen={run(async () => {
              const root = await bridge.pickFolder();
              if (root) await actions.openProject(root);
            })}
          />
        </div>
        <ImportReportDialog />
        <SponsorDialog />
        <UpdateDialog />
        <LicensesDialog />
      </>
    );
  }
  const chapters = manifest.chapters;
  const pages = entryRowsIn(readingOrder(manifest), manifest.editions, activeLanguage);
  const index = pages.findIndex((c) => c.id === currentId);
  const section = currentId ? sectionOf(manifest, currentId) : null;
  // A contents page has no text to edit: its list is generated, and the editor for it is the list.
  const contents = manifest.frontMatter.find((e) => e.id === currentId && e.kind === "contents");
  const chapterNo = chapters.findIndex((c) => c.id === currentId) + 1;
  // In Read mode the footer follows the scroll position, not the open chapter (which catches up a moment later).
  const readIndex = pages.findIndex((c) => c.id === readPosition.id);
  const readPage = readIndex < 0 ? null : readPosition.page;
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      {focus && (
        <IconButton
          icon={Minimize2}
          label={t`Exit focus mode`}
          className="fixed inset-e-3 top-3 z-(--z-float) bg-surface/80 backdrop-blur"
          onClick={() => setLayout({ focus: false })}
        />
      )}
      {!focus && (
        <AppHeader
          mode={mode}
          onMode={setMode}
          onShowChapters={() => setDrawer(true)}
          onExport={() => openExport("epub")}
          onAudio={() => openExport("audiobook")}
          onSettings={() => setView("settings")}
          onDetails={() => setDetailsOpen(true)}
          onReferences={() => setRefsSheet(true)}
          run={run}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {/* A div: the Sidebar's own nav is the landmark, an aside around it would be a second, unnamed one. */}
        <div
          className={cx("hidden w-66 shrink-0 overflow-y-auto bg-sidebar", focus ? "" : "lg:block")}
        >
          <Sidebar />
        </div>
        <main id="main" tabIndex={-1} className="outline-none flex min-h-0 min-w-0 flex-1 flex-col">
          {error && (
            <Notice role="alert" className="m-4">
              {error}
            </Notice>
          )}
          {reader && pages.length ? (
            // Keyed on the book, not the chapter: the open chapter follows the scroll without remounting the reader.
            <ReadingBook key={`${root}:${activeLanguage}:${reloadCount}`} />
          ) : contents && currentDoc && !reader ? (
            <TocEditor key={contents.id} entry={contents} />
          ) : currentDoc && currentId && !reader ? (
            <Editor
              key={`${currentId}:${reloadCount}`}
              initial={currentDoc}
              language={activeLanguage}
              onChange={actions.setDraft}
              focus={focus}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-ink-muted">
                {pages.length ? t`Choose a chapter to start.` : t`This book has no chapters yet.`}
              </p>
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => attempt(actions.add(t`Chapter ${chapters.length + 1}`))}
              >{t`Add chapter`}</Button>
            </div>
          )}
          {index < 0 ? null : reader ? (
            <ReadingFooter
              index={readIndex < 0 ? index : readIndex}
              page={readPage}
              pages={pages}
              chapterIds={chapters.map((c) => c.id)}
              language={activeLanguage}
              onSelect={(id) => attempt(actions.selectChapter(id))}
            />
          ) : (
            <StatusBar
              words={words}
              bookWords={bookWords}
              section={section}
              chapterNo={chapterNo}
              chapterCount={chapters.length}
              sessionWritten={sessionWritten}
              sessionGoal={sessionGoal}
              focus={focus}
            />
          )}
        </main>
        {!focus && !reader && (details || references) && (
          <aside
            aria-label={references ? t`References` : t`Details`}
            className={cx(
              "hidden shrink-0 overflow-y-auto border-s border-border bg-surface xl:block",
              references ? "w-80" : "w-70",
            )}
          >
            {references ? (
              <ReferencesPanel openId={viewingId} onOpen={setViewingId} />
            ) : (
              <Details
                manifest={manifest}
                pageTitle={pages[index]?.title ?? null}
                section={section}
                words={words}
                onChangeTemplate={() => setView("templates")}
                onEditDetails={() => setDetailsOpen(true)}
                onOpenReference={setViewingId}
              />
            )}
          </aside>
        )}
      </div>
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        format={exportFormat}
        onFormatChange={setExportFormat}
        onPreview={() => {
          setExportOpen(false);
          setView("print");
        }}
        onChangeTrimSize={() => {
          setExportOpen(false);
          setDetailsOpen(true);
        }}
        onOpenFonts={() => setView("fonts")}
      />
      <ChaptersDrawer open={drawer} onOpenChange={setDrawer} />
      <BookDetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} />
      <ImportDialog
        open={importingInto}
        onOpenChange={setImportingInto}
        pickSource={bridge.pickImportSource}
        pickFolder={bridge.pickFolder}
        onImport={actions.importBook}
        onImportInto={actions.importIntoBook}
      />
      <ReferencesSheet
        open={refsSheet}
        onOpenChange={setRefsSheet}
        openId={viewingId}
        onOpenId={setViewingId}
      />
      <ReferenceViewer id={viewingId} onClose={() => setViewingId(null)} />
      <RecoverDialog />
      <SponsorDialog />
      <UpdateDialog />
      <LicensesDialog />
      <ImportReportDialog />
    </div>
  );
}
