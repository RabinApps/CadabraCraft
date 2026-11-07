import { useCallback, useState, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { sourceEdition } from "@cadabracraft/format";
import { errText } from "../../lib/projectError";
import { useProject } from "../../state/project/index";
import { ExportDialog } from "../export/ExportDialog";
import { PrintPreview } from "../export/PrintPreview";
import { Settings } from "../settings/Settings";
import { Templates } from "../export/Templates";
import { SceneBoard } from "../board/SceneBoard";
import { Timeline } from "../timeline/Timeline";
import { QuickNav } from "../quicknav/QuickNav";
import { Onboarding } from "../onboarding/Onboarding";
import { SponsorDialog } from "../dialogs/SponsorDialog";
import { LicensesDialog } from "../dialogs/LicensesDialog";
import { UpdateDialog } from "../dialogs/UpdateDialog";
import { useWindowTitle } from "../hooks/useWindowTitle";
import { useAppMenu } from "../hooks/useAppMenu";
import type { View } from "../hooks/appMenuCommands";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useSaveOnClose } from "../hooks/useSaveOnClose";
import { useWordCount } from "../hooks/useWordCount";
import { useBookWordCount } from "../hooks/useBookWordCount";
import { useSessionWords } from "../hooks/useSessionWords";
import { useLayout } from "../../state/view/layout";
import { useSettings } from "../../state/view/editorPrefs";
import { useViewMode } from "../../state/view/viewMode";
import { useOnboarding } from "../../state/app/onboarding";
import { OpeningSkeleton } from "./OpeningSkeleton";
import { BookScreen } from "./screens/BookScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { useBookEffects } from "./screens/useBookEffects";
import { useBookOverlays, useExportControl } from "./screens/useScreenState";

/** The title of the window for a full-page view (`fonts` is Settings scrolled to Fonts, from the "font missing" notice). */
function useViewTitle(view: View) {
  const { t } = useLingui();
  const titles: Partial<Record<View, string>> = {
    welcome: t`Welcome`,
    settings: t`Settings`,
    fonts: t`Settings`,
    templates: t`Templates`,
    print: t`Print preview`,
    board: t`Scene board`,
    timeline: t`Timeline`,
  };
  const title = useProject((s) =>
    s.manifest ? sourceEdition(s.manifest.editions).title : undefined,
  );
  useWindowTitle(titles[view], title);
}

/** The app and, above every screen, the command palette and the outline navigator. */
export function App() {
  return (
    <>
      <AppScreens />
      <QuickNav />
    </>
  );
}

/** The views that replace the whole window while a book is open, each given the way back to the book. */
const FULL_PAGE_VIEWS: Partial<Record<View, (onBack: () => void) => ReactNode>> = {
  templates: (onBack) => <Templates onBack={onBack} />,
  board: (onBack) => <SceneBoard onBack={onBack} />,
  timeline: (onBack) => <Timeline onBack={onBack} />,
};

function AppScreens() {
  const manifest = useProject((s) => s.manifest);
  const activeLanguage = useProject(
    (s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "",
  );
  const opening = useProject((s) => s.opening);
  const root = useProject((s) => s.root);
  const [drawer, setDrawer] = useState(false);
  const { mode, setMode } = useViewMode();
  // The welcome screen opens by itself on the first run, before Home; Help > Welcome to CadabraCraft… reopens it.
  const seenWelcome = useOnboarding((s) => s.seen);
  const [view, setView] = useState<View>(seenWelcome ? "book" : "welcome");
  useViewTitle(view);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const overlays = useBookOverlays();
  const exporting = useExportControl();
  const { focus: focusPref, set: setLayout } = useLayout();
  const reader = mode === "read";
  // Focus mode is for writing; reading mode already has its own bare layout.
  const focus = focusPref && !reader && manifest !== null;
  const exitFocus = useCallback(() => setLayout({ focus: false }), [setLayout]);
  useGlobalShortcuts({ open: manifest !== null, focus, exitFocus });
  useSaveOnClose();
  const words = useWordCount();
  const bookWords = useBookWordCount();
  useBookEffects(bookWords, setDrawer);
  const sessionWritten = useSessionWords(root, activeLanguage, bookWords);
  const sessionGoal = useSettings((s) => s.sessionGoal);
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
    openExport: exporting.openExport,
    openDetails: () => setDetailsOpen(true),
    openWelcome: () => setView("welcome"),
    fail: setError,
  });
  const backToBook = () => setView("book");
  const skeleton = opening && view === "book" ? <OpeningSkeleton name={opening.name} /> : null;
  if (skeleton && manifest) return skeleton;
  if (view === "welcome") {
    const done = () => {
      useOnboarding.getState().markSeen();
      setView("book");
    };
    return (
      <>
        <Onboarding onDone={done} />
        <UpdateDialog />
        <LicensesDialog />
      </>
    );
  }
  if (view === "settings" || view === "fonts") {
    return (
      <>
        <Settings onBack={backToBook} initialSection={view === "fonts" ? "fonts" : undefined} />
        <UpdateDialog />
        <LicensesDialog />
      </>
    );
  }
  const fullPage = manifest ? FULL_PAGE_VIEWS[view] : undefined;
  if (fullPage) return fullPage(backToBook);
  if (manifest && view === "print") {
    return (
      <>
        <PrintPreview onBack={backToBook} onExport={exporting.openExport} />
        <ExportDialog
          open={exporting.open}
          onOpenChange={exporting.setOpen}
          format={exporting.format}
          onFormatChange={exporting.setFormat}
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
      <HomeScreen
        skeleton={skeleton}
        error={error}
        setError={setError}
        run={run}
        onSettings={() => setView("settings")}
      />
    );
  }
  return (
    <BookScreen
      manifest={manifest}
      mode={mode}
      setMode={setMode}
      setView={setView}
      focus={focus}
      error={error}
      run={run}
      drawer={drawer}
      setDrawer={setDrawer}
      detailsOpen={detailsOpen}
      setDetailsOpen={setDetailsOpen}
      exporting={exporting}
      overlays={overlays}
      words={words}
      bookWords={bookWords}
      sessionWritten={sessionWritten}
      sessionGoal={sessionGoal}
    />
  );
}
