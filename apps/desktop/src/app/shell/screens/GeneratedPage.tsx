import { useEffect, useState } from "react";
import type { ChapterDoc } from "@cadabracraft/shared";
import { Editor } from "../../../editor/Editor";
import { useProject } from "../../../state/project/index";

/**
 * An index or glossary page the author put in the back matter: the list is generated from the marks, so the page is shown as it will
 * be written and cannot be typed into (the list changes in its panel). It is read again when the book's pages change.
 */
export function GeneratedPage({
  pageId,
  language,
  reloadCount,
}: {
  pageId: string;
  language: string;
  reloadCount: number;
}) {
  const readPages = useProject((s) => s.actions.readPages);
  const manifest = useProject((s) => s.manifest);
  const [doc, setDoc] = useState<ChapterDoc | null>(null);
  useEffect(() => {
    let live = true;
    void readPages().then((pages) => {
      if (live) setDoc(pages.find((p) => p.id === pageId)?.doc ?? null);
    });
    return () => {
      live = false;
    };
  }, [readPages, pageId, manifest]);
  if (!doc) return null;
  return (
    <Editor
      key={`${pageId}:${reloadCount}:${JSON.stringify(doc).length}`}
      initial={doc}
      language={language}
      onChange={() => undefined}
      focus={false}
      readOnly
    />
  );
}
