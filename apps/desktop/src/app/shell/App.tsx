import { useCallback, useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import {
  readingOrder,
  sectionOf,
  sourceEdition,
  entryRows,
  entryRowsIn,
} from "@cadabracraft/format";
import { Minimize2, Plus, X } from "lucide-react";
import { Editor } from "../../editor/Editor";
import { ReadingFooter } from "../../editor/ReadingFooter";
import { bridge } from "../../lib/bridge";
import { errText } from "../../lib/projectError";
import { Button, IconButton } from "../../ui/Button";
import { overlayClass, panelClass } from "../../ui/Dialog";
import { cx } from "../../ui/cx";
import { Details } from "./Details";
import { ReferencesPanel } from "../references/ReferencesPanel";
import { ReferenceViewer } from "../references/ReferenceViewer";
import { BookDetailsDialog } from "../dialogs/BookDetailsDialog";
import { ExportDialog } from "../export/ExportDialog";
import type { ExportFormat } from "../export/exportFormat";
import { Home } from "../home/Home";
import { AppHeader } from "./AppHeader";
import { ImportReportDialog } from "../dialogs/ImportDialogs";
import { PrintPreview } from "../export/PrintPreview";
import { Settings } from "../settings/Settings";
import { SponsorDialog } from "../dialogs/SponsorDialog";
import { UpdateDialog } from "../dialogs/UpdateDialog";
import { RecoverDialog } from "../dialogs/RecoverDialog";
import { useUpdates } from "../../state/updates";
import { Sidebar } from "./Sidebar";
import { Templates } from "../export/Templates";
import { useLayout } from "../../state/layout";
import { useReading } from "../../state/reading";
import { useRecents } from "../../state/recents";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";
import { useAppMenu } from "./useAppMenu";
import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useSaveOnClose } from "../hooks/useSaveOnClose";
import { useWordCount } from "../hooks/useWordCount";
import { useBookWordCount } from "../hooks/useBookWordCount";
import { useSessionWords } from "../hooks/useSessionWords";
import { useSettings } from "../../state/editorPrefs";
import { LG_QUERY } from "./breakpoints";
import { Notice } from "../../ui/Notice";
import { ProgressBar } from "../../ui/ProgressBar";

/** Full-page views. "book" is the editor (or Home when no project is open). */
type View = "book" | "settings" | "templates" | "print";

export function App() {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const activeLanguage = useProject(
    (s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "",
  );
  const currentId = useProject((s) => s.currentId);
  const currentDoc = useProject((s) => s.currentDoc);
  const reloadCount = useProject((s) => s.reloadCount);
  const actions = useProject((s) => s.actions);
  const open = manifest !== null;
  const root = useProject((s) => s.root);
  const title = manifest ? sourceEdition(manifest.editions).title : undefined;
  const addRecent = useRecents((s) => s.add);
  // Any successful open, create or import lands here.
  useEffect(() => {
    if (root && title !== undefined) addRecent(root, title);
  }, [root, title, addRecent]);
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState<"write" | "read">("write");
  const [view, setView] = useState<View>("book");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [refsSheet, setRefsSheet] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("epub");
  const openExport = (format: ExportFormat) => {
    setExportFormat(format);
    setExportOpen(true);
  };
  const reading = useReading();
  const { focus: focusPref, details, references, set: setLayout } = useLayout();
  const reader = mode === "read";
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
    return () => void un.then((f) => f());
  }, [open, actions]);
  useEffect(() => {
    if (import.meta.env.PROD) void useUpdates.getState().check(false);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia(LG_QUERY);
    const close = () => {
      if (mq.matches) setDrawer(false);
    };
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
  if (view === "settings") {
    return (
      <>
        <Settings onBack={backToBook} />
        <UpdateDialog />
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
        />
        <SponsorDialog />
        <UpdateDialog />
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
          onCreate={(root, title, author) =>
            run(() => actions.createProject(root, title, author))()
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
        <ImportReportDialog />
        <SponsorDialog />
        <UpdateDialog />
      </>
    );
  }
  const chapters = manifest.chapters;
  const pages = entryRowsIn(readingOrder(manifest), manifest.editions, activeLanguage);
  const index = pages.findIndex((c) => c.id === currentId);
  const section = currentId ? sectionOf(manifest, currentId) : null;
  const chapterNo = chapters.findIndex((c) => c.id === currentId) + 1;
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
        <aside
          className={cx("hidden w-66 shrink-0 overflow-y-auto bg-sidebar", focus ? "" : "lg:block")}
        >
          <Sidebar />
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error && (
            <Notice role="alert" className="m-4">
              {error}
            </Notice>
          )}
          {currentDoc && currentId ? (
            reader ? (
              <Editor
                key={`${currentId}:read:${reloadCount}`}
                initial={currentDoc}
                language={activeLanguage}
                reading={reading}
              />
            ) : (
              <Editor
                key={`${currentId}:${reloadCount}`}
                initial={currentDoc}
                language={activeLanguage}
                onChange={actions.setDraft}
                focus={focus}
              />
            )
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
              index={index}
              pages={pages}
              chapterIds={chapters.map((c) => c.id)}
              language={activeLanguage}
              onSelect={(id) => attempt(actions.selectChapter(id))}
            />
          ) : (
            <footer
              className={cx(
                "hidden shrink-0 items-center justify-between border-t border-border bg-surface px-4 py-1.5 text-xs text-ink-muted md:flex",
                focus && "md:hidden",
              )}
            >
              {sessionGoal > 0 && sessionWritten !== null && (
                <span className="flex items-center gap-2" data-testid="session-goal">
                  <ProgressBar
                    label={t`Session goal`}
                    value={Math.min(sessionWritten, sessionGoal)}
                    max={sessionGoal}
                    className="h-1.5 w-24 bg-border"
                  />
                  {t`${sessionWritten} of ${sessionGoal} words this session`}
                </span>
              )}
              <span>
                {section === "chapter"
                  ? plural(words, {
                      one: "# word in this chapter",
                      other: "# words in this chapter",
                    })
                  : plural(words, { one: "# word on this page", other: "# words on this page" })}
                {bookWords !== null && ` · ${t`${bookWords} in the book`}`}
              </span>
              <span>
                {section === "front"
                  ? t`Front matter`
                  : section === "back"
                    ? t`Back matter`
                    : t`Chapter ${chapterNo} of ${chapters.length}`}
              </span>
            </footer>
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
      />
      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className={cx(overlayClass, "lg:hidden")} />
          <D.Content
            aria-describedby={undefined}
            className={cx(
              panelClass,
              "inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-lg bg-sidebar lg:hidden",
              "md:inset-y-0 md:inset-s-0 md:inset-e-auto md:max-h-none md:w-80 md:rounded-none",
            )}
          >
            <D.Title className="sr-only">{t`Chapters`}</D.Title>
            <div className="flex justify-end px-2 pt-2">
              <D.Close asChild>
                <IconButton icon={X} label={t`Close chapters`} />
              </D.Close>
            </div>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
      <BookDetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} />
      <D.Root open={refsSheet} onOpenChange={setRefsSheet}>
        <D.Portal>
          <D.Overlay className={cx(overlayClass, "xl:hidden")} />
          <D.Content
            aria-describedby={undefined}
            className={cx(
              panelClass,
              "inset-x-0 bottom-0 h-[80dvh] overflow-hidden rounded-t-lg bg-surface xl:hidden",
              "md:inset-y-0 md:inset-e-0 md:inset-s-auto md:h-auto md:w-100 md:rounded-none md:border-e-0",
            )}
          >
            <D.Title className="sr-only">{t`References`}</D.Title>
            <ReferencesPanel
              onClose={() => setRefsSheet(false)}
              openId={viewingId}
              onOpen={(id) => {
                setRefsSheet(false);
                setViewingId(id);
              }}
            />
          </D.Content>
        </D.Portal>
      </D.Root>
      <ReferenceViewer id={viewingId} onClose={() => setViewingId(null)} />
      <RecoverDialog />
      <SponsorDialog />
      <UpdateDialog />
      <ImportReportDialog />
    </div>
  );
}
