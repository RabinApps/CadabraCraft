import { useLingui } from "@lingui/react/macro";
import {
  readingOrder,
  sectionOf,
  entryRowsIn,
  chaptersOf,
  type Manifest,
} from "@cadabracraft/format";
import { Minimize2, Plus } from "lucide-react";
import { Editor } from "../../../editor/Editor";
import { TocEditor } from "../../toc/TocEditor";
import { ReadingBook } from "../../../editor/reading/ReadingBook";
import { ReadingFooter } from "../../../editor/reading/ReadingFooter";
import { bridge } from "../../../lib/bridge";
import { Button, IconButton } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Notice } from "../../../ui/feedback/Notice";
import { sceneRow } from "../../../lib/scenes/scenes";
import { useSceneView } from "../../../state/view/sceneView";
import { useReadingPosition } from "../../../state/view/readingPosition";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useLayout } from "../../../state/view/layout";
import { useProject } from "../../../state/project/index";
import { attempt } from "../../../state/attempt";
import { useStartDialogs } from "../../../state/app/commands";
import { ReferenceViewer } from "../../references/ReferenceViewer";
import { BookDetailsDialog } from "../../dialogs/BookDetailsDialog";
import { ImportDialog, ImportReportDialog } from "../../dialogs/LazyImportDialogs";
import { SponsorDialog } from "../../dialogs/SponsorDialog";
import { LicensesDialog } from "../../dialogs/LicensesDialog";
import { UpdateDialog } from "../../dialogs/UpdateDialog";
import { RecoverDialog } from "../../dialogs/RecoverDialog";
import { ExportDialog } from "../../export/ExportDialog";
import type { View } from "../../hooks/appMenuCommands";
import type { useSessionWords } from "../../hooks/useSessionWords";
import { AppHeader } from "../header/AppHeader";
import { StatusBar } from "../header/StatusBar";
import { Sidebar } from "../sidebar/Sidebar";
import { SidebarResizeHandle } from "../sidebar/SidebarResizeHandle";
import { ChaptersDrawer, CommentsSheet, ReferencesSheet, ScenesSheet } from "../Drawers";
import { SidePanel } from "./SidePanel";
import type { BookOverlays, ExportControl } from "./useScreenState";

export interface BookScreenProps {
  manifest: Manifest;
  mode: "write" | "read";
  setMode: (mode: "write" | "read") => void;
  setView: (view: View) => void;
  focus: boolean;
  error: string;
  run: (f: () => Promise<void>) => () => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  exporting: ExportControl;
  overlays: BookOverlays;
  words: number;
  bookWords: number | null;
  sessionWritten: ReturnType<typeof useSessionWords>;
  sessionGoal: number;
}

/** Where the open page sits in the book: the chapters, the reading order's rows, the page's index and its section. */
function placeOf(manifest: Manifest, currentId: string | null, language: string) {
  const chapters = chaptersOf(manifest);
  const pages = entryRowsIn(readingOrder(manifest), manifest.editions, language);
  const index = pages.findIndex((c) => c.id === currentId);
  const section = currentId ? sectionOf(manifest, currentId) : null;
  return { chapters, pages, index, section };
}

/** The sidebar at the left of the page. */
function SidebarColumn({ focus }: { focus: boolean }) {
  const { sidebarWidth, set: setLayout } = useLayout();
  return (
    // A div: the Sidebar's own nav is the landmark, an aside around it would be a second, unnamed one.
    <div
      id="chapters-sidebar"
      className={cx("relative hidden min-h-0 shrink-0 bg-sidebar", focus ? "" : "lg:block")}
      style={{
        width: sidebarWidth,
        minWidth: SIDEBAR_MIN_WIDTH,
        maxWidth: SIDEBAR_MAX_WIDTH,
      }}
    >
      <div className="absolute inset-0">
        <Sidebar />
      </div>
      {!focus && (
        <SidebarResizeHandle
          width={sidebarWidth}
          onChange={(width) => setLayout({ sidebarWidth: width })}
        />
      )}
    </div>
  );
}

/** What fills the page: the reader, the contents list, the editor, or the way to add a first chapter. */
function PageBody({
  manifest,
  reader,
  focus,
}: {
  manifest: Manifest;
  reader: boolean;
  focus: boolean;
}) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const root = useProject((s) => s.root);
  const currentId = useProject((s) => s.currentId);
  const currentDoc = useProject((s) => s.currentDoc);
  const reloadCount = useProject((s) => s.reloadCount);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const { chapters, pages } = placeOf(manifest, currentId, language);
  // A contents page has no text to edit: its list is generated, and the editor for it is the list.
  const contents = manifest.frontMatter.find((e) => e.id === currentId && e.kind === "contents");
  // A blank page holds no text either: Page view draws its page, and the editor is read-only, so nothing can be typed into it and
  // then left out of the PDF.
  const blank = readingOrder(manifest).find((e) => e.id === currentId)?.kind === "blank";
  if (reader && pages.length)
    // Keyed on the book, not the chapter: the open chapter follows the scroll without remounting the reader.
    return <ReadingBook key={`${root}:${language}:${reloadCount}`} />;
  if (contents && currentDoc && !reader) return <TocEditor key={contents.id} entry={contents} />;
  if (currentDoc && currentId && !reader)
    return (
      <Editor
        key={`${currentId}:${reloadCount}`}
        initial={currentDoc}
        language={language}
        onChange={actions.setDraft}
        focus={focus}
        readOnly={blank}
      />
    );
  return (
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
  );
}

type FooterProps = Pick<
  BookScreenProps,
  "manifest" | "words" | "bookWords" | "sessionWritten" | "sessionGoal"
> & { reader: boolean; focus: boolean };

/** The footer of the page: the reading position in Read mode, the word counts in Write mode. */
function PageFooter({
  manifest,
  reader,
  focus,
  words,
  bookWords,
  sessionWritten,
  sessionGoal,
}: FooterProps) {
  const actions = useProject((s) => s.actions);
  const currentId = useProject((s) => s.currentId);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const readPosition = useReadingPosition();
  const { chapters, pages, index, section } = placeOf(manifest, currentId, language);
  // In Read mode the footer follows the scroll position, not the open chapter (which catches up a moment later).
  const readIndex = pages.findIndex((c) => c.id === readPosition.id);
  if (index < 0) return null;
  if (reader)
    return (
      <ReadingFooter
        index={readIndex < 0 ? index : readIndex}
        page={readIndex < 0 ? null : readPosition.page}
        pages={pages}
        chapterIds={chapters.map((c) => c.id)}
        language={language}
        onSelect={(id) => attempt(actions.selectChapter(id))}
      />
    );
  return (
    <StatusBar
      words={words}
      bookWords={bookWords}
      section={section}
      chapterNo={chapters.findIndex((c) => c.id === currentId) + 1}
      chapterCount={chapters.length}
      sessionWritten={sessionWritten}
      sessionGoal={sessionGoal}
      focus={focus}
    />
  );
}

/** The dialogs and sheets that open over the page. */
function BookDialogs({
  drawer,
  setDrawer,
  detailsOpen,
  setDetailsOpen,
  setView,
  exporting,
  overlays,
}: Pick<
  BookScreenProps,
  "drawer" | "setDrawer" | "detailsOpen" | "setDetailsOpen" | "setView" | "exporting" | "overlays"
>) {
  const actions = useProject((s) => s.actions);
  const { importingInto, setImportingInto } = useStartDialogs();
  return (
    <>
      <ExportDialog
        open={exporting.open}
        onOpenChange={exporting.setOpen}
        format={exporting.format}
        onFormatChange={exporting.setFormat}
        onPreview={() => {
          exporting.setOpen(false);
          setView("print");
        }}
        onChangeTrimSize={() => {
          exporting.setOpen(false);
          setDetailsOpen(true);
        }}
        onOpenFonts={() => setView("fonts")}
      />
      <ChaptersDrawer open={drawer} onOpenChange={setDrawer} />
      <CommentsSheet open={overlays.commentsSheet} onOpenChange={overlays.setCommentsSheet} />
      <ScenesSheet open={overlays.scenesSheet} onOpenChange={overlays.setScenesSheet} />
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
        open={overlays.refsSheet}
        onOpenChange={overlays.setRefsSheet}
        openId={overlays.viewingId}
        onOpenId={overlays.setViewingId}
      />
      <ReferenceViewer id={overlays.viewingId} onClose={() => overlays.setViewingId(null)} />
      <RecoverDialog />
      <SponsorDialog />
      <UpdateDialog />
      <LicensesDialog />
      <ImportReportDialog />
    </>
  );
}

/** The open book: header, chapter sidebar, the page (editor, reader or contents), the side panel and the dialogs over them. */
export function BookScreen(props: BookScreenProps) {
  const { t } = useLingui();
  const { manifest, mode, setMode, setView, focus, error, run, setDrawer, exporting, overlays } =
    props;
  const currentId = useProject((s) => s.currentId);
  const currentDoc = useProject((s) => s.currentDoc);
  const language = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const activeScene = useSceneView((s) => s.active);
  const { details, references, comments, set: setLayout } = useLayout();
  const reader = mode === "read";
  const { pages, index, section } = placeOf(manifest, currentId, language);
  // A scene the sidebar is pointing at takes the rail: its notes are what the author is working on.
  const scene = sceneRow(currentDoc, activeScene);
  const openDetails = () => props.setDetailsOpen(true);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-ink">
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
          onExport={() => exporting.openExport("epub")}
          onAudio={() => exporting.openExport("audiobook")}
          onSettings={() => setView("settings")}
          onDetails={openDetails}
          onReferences={() => overlays.setRefsSheet(true)}
          onComments={() => overlays.setCommentsSheet(true)}
          onScenes={() => overlays.setScenesSheet(true)}
          onBoard={() => setView("board")}
          onTimeline={() => setView("timeline")}
          run={run}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <SidebarColumn focus={focus} />
        <main
          id="main"
          tabIndex={-1}
          className="outline-none flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
        >
          {error && (
            <Notice role="alert" className="m-4">
              {error}
            </Notice>
          )}
          <PageBody manifest={manifest} reader={reader} focus={focus} />
          <PageFooter {...props} reader={reader} />
        </main>
        {!focus && !reader && (scene || details || references || comments) && (
          <SidePanel
            scene={scene !== null}
            manifest={manifest}
            pageTitle={pages[index]?.title ?? null}
            section={section}
            words={props.words}
            viewingId={overlays.viewingId}
            setViewingId={overlays.setViewingId}
            onChangeTemplate={() => setView("templates")}
            onEditDetails={openDetails}
          />
        )}
      </div>
      <BookDialogs {...props} />
    </div>
  );
}
