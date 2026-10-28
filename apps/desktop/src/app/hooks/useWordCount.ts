import { useEffect, useState } from "react";
import { countWords } from "@cadabracraft/shared";
import { useProject } from "../../state/project/index";

/** Words in the open page. Counts at once for a freshly loaded page, but debounces while typing so large chapters stay responsive. */
export function useWordCount(): number {
  const draft = useProject((s) => s.draft);
  const currentDoc = useProject((s) => s.currentDoc);
  const [words, setWords] = useState(0);
  useEffect(() => {
    if (!draft) { setWords(countWords(currentDoc)); return; }
    const timer = setTimeout(() => setWords(countWords(draft)), 250);
    return () => clearTimeout(timer);
  }, [draft, currentDoc]);
  return words;
}
