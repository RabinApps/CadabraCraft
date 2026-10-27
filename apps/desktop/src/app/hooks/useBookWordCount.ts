import { useEffect, useState } from "react";
import { useProject } from "../../state/project/index";

/** Words in all chapters (front and back matter excluded), or null until the first count. Re-counts a second after the last saved change; only pages that changed are read again. */
export function useBookWordCount(): number | null {
  const manifest = useProject((s) => s.manifest);
  const currentDoc = useProject((s) => s.currentDoc);
  const bookWords = useProject((s) => s.actions.bookWords);
  const [words, setWords] = useState<number | null>(null);
  useEffect(() => {
    if (!manifest) { setWords(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      bookWords()
        .then((n) => { if (live) setWords(n); })
        .catch(() => { if (live) setWords(null); });
    }, 1000);
    return () => { live = false; clearTimeout(timer); };
  }, [manifest, currentDoc, bookWords]);
  return words;
}
