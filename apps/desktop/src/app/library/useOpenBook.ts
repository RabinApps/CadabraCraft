import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { isMissingFolder, whyText } from "../../lib/projectError";

/**
 * Opens a known book and remembers the ones that failed (moved, renamed or deleted folders). The entry stays in the list so the
 * author removes it deliberately; the value is what to tell them (the real reason when the folder exists but the book is unreadable).
 */
export function useOpenBook(onOpenRecent: (root: string) => Promise<void>) {
  const { t } = useLingui();
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  const forget = (root: string) =>
    setProblems((m) => {
      if (!m.has(root)) return m;
      const n = new Map(m);
      n.delete(root);
      return n;
    });
  const open = (root: string) =>
    onOpenRecent(root).then(
      () => forget(root),
      (e: unknown) =>
        setProblems((m) =>
          new Map(m).set(
            root,
            isMissingFolder(e)
              ? t`Folder not found. Remove it from the list or move it back.`
              : t`Could not open this book: ${whyText(e)}. Check the folder is not open elsewhere, or remove it from the list and open it again.`,
          ),
        ),
    );
  return { open, problems, forget };
}
