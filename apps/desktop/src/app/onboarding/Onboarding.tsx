import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  ArrowRight,
  BookOpen,
  FileUp,
  HardDrive,
  Headphones,
  Heart,
  Languages,
  PenLine,
} from "lucide-react";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { SPONSOR_URL } from "../../state/sponsor";
import { Button } from "../../ui/Button";
import { Notice } from "../../ui/Notice";

/**
 * The first-run welcome: one screen that says what the app does and who pays for it. Shown once, before Home; Help >
 * Welcome to CadabraCraft… brings it back. Nothing is sent anywhere unless Sponsor is pressed, which opens the page in
 * the author's own browser.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t } = useLingui();
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  // Focus the heading, so a keyboard or screen reader starts at the first thing the screen says.
  useEffect(() => heading.current?.focus(), []);
  const features = [
    {
      icon: PenLine,
      title: t`Write the whole book`,
      body: t`Chapters, front and back matter, footnotes, tables and images in a calm editor.`,
    },
    {
      icon: FileUp,
      title: t`Bring what you have`,
      body: t`Import Word, Markdown, HTML or plain text. A report lists anything that could not be kept.`,
    },
    {
      icon: BookOpen,
      title: t`Publish EPUB and print PDF`,
      body: t`EPUB 3 that passes EPUBCheck, and a print-ready PDF at your trim size.`,
    },
    {
      icon: Headphones,
      title: t`Listen, or hand it off`,
      body: t`Render an audiobook, or export a Word or Markdown manuscript for an agent or editor.`,
    },
    {
      icon: Languages,
      title: t`Translate your book`,
      body: t`Editions keep translations in the same book, exported separately.`,
    },
    {
      icon: HardDrive,
      title: t`Yours, on your computer`,
      body: t`Each book is a folder you own. No account, no telemetry, no cloud.`,
    },
  ];
  const sponsor = () => {
    setError("");
    bridge.openUrl(SPONSOR_URL).catch((e) => {
      const why = whyText(e);
      setError(
        t`Could not open ${SPONSOR_URL}: ${why}. Copy the address into your browser instead.`,
      );
    });
  };
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <main
        id="main"
        tabIndex={-1}
        className="outline-none mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-5 py-8 md:px-16 md:py-10"
      >
        <header className="flex items-center gap-2.5">
          <img
            src="/brand/cadabracraft-icon.svg"
            alt=""
            width={32}
            height={32}
            className="size-8"
          />
          <span className="font-book text-title font-semibold">CadabraCraft</span>
        </header>
        <div className="flex flex-col gap-3">
          <h1
            ref={heading}
            tabIndex={-1}
            className="outline-none font-book text-heading font-semibold md:text-display"
          >{t`Welcome to CadabraCraft`}</h1>
          <p className="max-w-xl text-sm leading-relaxed text-ink-muted md:text-lead">{t`Write, format and publish your book — everything stays on your computer.`}</p>
          <div>
            <Button
              variant="primary"
              icon={ArrowRight}
              onClick={onDone}
              className="w-full sm:w-auto"
            >{t`Get started`}</Button>
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {features.map((f) => (
            <li
              key={f.title}
              className="flex items-center gap-3 rounded-md border border-border bg-surface p-4 md:flex-col md:items-start md:gap-2.5"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <f.icon size={16} aria-hidden />
              </span>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-semibold">{f.title}</h2>
                <p className="text-xs leading-relaxed text-ink-muted md:text-small">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:gap-4">
          <div className="flex items-start gap-3 md:flex-1">
            <Heart size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-muted" />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold">{t`CadabraCraft is 100% supported by sponsors.`}</p>
              <p className="text-xs text-ink-muted">{t`No ads, no account, and the app is never sold.`}</p>
            </div>
          </div>
          <Button
            icon={Heart}
            onClick={() => void sponsor()}
            className="w-full md:w-auto"
          >{t`Sponsor CadabraCraft`}</Button>
        </div>
        {error && <Notice role="alert">{error}</Notice>}
      </main>
    </div>
  );
}
