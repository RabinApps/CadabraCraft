import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { currentSection, SECTION_TOP_GAP } from "../../lib/reading/settingsScroll";
import { cx } from "../../ui/cx";
import { useSettings } from "../../state/view/editorPrefs";
import { AudioSection } from "./AudioSection";
import { FontsSection } from "./FontsSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { BackupsSection } from "./BackupsSection";
import { HelpSection } from "./HelpSection";
import { AppearanceSection, EditorSection, GeneralSection } from "./SettingsSections";

const sections = [
  "appearance",
  "general",
  "editor",
  "fonts",
  "audio",
  "backups",
  "shortcuts",
  "help",
] as const;

/** Preferences page. Every control saves immediately, so there is no primary action. */
export function Settings({
  onBack,
  initialSection,
}: {
  onBack: () => void;
  /** Scroll to this section when the page opens. */
  initialSection?: (typeof sections)[number];
}) {
  const { t } = useLingui();
  const { audioVoice, audioFormats, set } = useSettings();
  const navLabels: Record<(typeof sections)[number], string> = {
    appearance: t`Appearance`,
    general: t`General`,
    editor: t`Editor`,
    fonts: t`Fonts`,
    audio: t`Audio`,
    backups: t`Backups`,
    shortcuts: t`Shortcuts`,
    help: t`Help`,
  };
  const [active, setActive] = useState<(typeof sections)[number]>(initialSection ?? "appearance");
  const mainRef = useRef<HTMLElement>(null);
  /** Until this time a nav click is scrolling, and the scroll must not move the highlight off the section that was clicked. */
  const jumpingUntil = useRef(0);
  // Scrolls the content area only; scrollIntoView would also scroll the page behind it and push the header away.
  const scrollTo = (id: string, behavior: ScrollBehavior) => {
    const main = mainRef.current;
    const el = document.getElementById(id);
    if (!main || !el) return;
    const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top;
    main.scrollTo({ top: main.scrollTop + top - SECTION_TOP_GAP, behavior });
  };
  useEffect(() => {
    if (initialSection) scrollTo(initialSection, "auto");
  }, [initialSection]);
  const jump = (id: (typeof sections)[number]) => {
    setActive(id);
    jumpingUntil.current = Date.now() + 800;
    // Smooth scrolling is an animation: skipped when the system asks for reduced motion.
    scrollTo(id, matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  };
  // The nav follows the content when it is scrolled by hand.
  const follow = () => {
    const main = mainRef.current;
    if (!main || Date.now() < jumpingUntil.current) return;
    const from = main.getBoundingClientRect().top;
    const tops = sections.map(
      (id) => (document.getElementById(id)?.getBoundingClientRect().top ?? 0) - from,
    );
    const atEnd = main.scrollTop + main.clientHeight >= main.scrollHeight - 2;
    setActive(sections[currentSection(tops, atEnd)]!);
  };
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
        <h1 className="font-book text-base font-semibold">{t`Settings`}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t`Settings sections`}
          className="hidden w-[220px] shrink-0 flex-col gap-0.5 bg-sidebar p-3 sm:flex"
        >
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={id === active ? "location" : undefined}
              onClick={() => jump(id)}
              className={cx(
                "rounded-md px-3 py-2 text-start text-sm font-medium hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent",
                id === active ? "bg-accent-soft text-ink" : "text-ink-muted",
              )}
            >
              {navLabels[id]}
            </button>
          ))}
        </nav>
        {/* relative: the visually hidden inputs inside are positioned against this box, not the window, so they cannot make the page itself scroll. */}
        <main
          id="main"
          tabIndex={-1}
          ref={mainRef}
          onScroll={follow}
          className="outline-none relative min-h-0 flex-1 overflow-y-auto"
        >
          {/* The bottom space lets the last sections scroll up to the top, where the nav jump puts them. */}
          <div className="mx-auto flex max-w-[640px] flex-col gap-8 p-4 sm:pb-[70dvh] md:p-10 md:pb-[70dvh]">
            <AppearanceSection title={navLabels.appearance} />
            <GeneralSection title={navLabels.general} />
            <EditorSection title={navLabels.editor} />
            <FontsSection title={navLabels.fonts} />
            <AudioSection
              voice={audioVoice}
              formats={audioFormats}
              title={navLabels.audio}
              onVoice={(v) => set({ audioVoice: v })}
              onFormats={(f) => set({ audioFormats: f })}
            />
            <BackupsSection title={navLabels.backups} />
            <p className="-mt-4 text-xs text-ink-muted">{t`Open a chapter's History from its menu in the chapter list to compare and restore. Keep .cadabra out of cloud sync: snapshots belong to this computer.`}</p>
            <ShortcutsSection title={navLabels.shortcuts} />
            <HelpSection title={navLabels.help} />
          </div>
        </main>
      </div>
    </div>
  );
}
