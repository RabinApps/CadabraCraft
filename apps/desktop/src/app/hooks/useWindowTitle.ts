import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const APP = "CadabraCraft";

/** The page and window title: where you are first, then the book, then the app ("Settings - My Book - CadabraCraft"). */
export function windowTitle(screen: string | undefined, book: string | undefined): string {
  return [screen, book?.trim() || undefined, APP].filter(Boolean).join(" - ");
}

/** Keeps `document.title` and the native window title in step with the screen and book, so a screen reader announces where you are (WCAG 2.4.2). */
export function useWindowTitle(screen: string | undefined, book: string | undefined) {
  useEffect(() => {
    const text = windowTitle(screen, book);
    document.title = text;
    // Outside the desktop shell (browser, tests) there is no native window.
    try {
      void getCurrentWindow()
        .setTitle(text)
        .catch(() => {});
    } catch {
      /* no native window */
    }
  }, [screen, book]);
}
