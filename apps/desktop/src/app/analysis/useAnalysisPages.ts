import { useEffect, useState } from "react";
import { errText } from "../../lib/projectError";
import type { BookPage } from "../../state/project/types";
import { useProject } from "../../state/project/index";

export interface AnalysisPages {
  pages: BookPage[] | null;
  error: string;
  /** The page that is open in the editor (the Chapter tab reads it). */
  openId: string | null;
}

/**
 * The book's pages as the report reads them, loaded each time the report opens so the counts follow what was typed. The
 * store flushes the open page first, so the open chapter is the saved one.
 */
export function useAnalysisPages(open: boolean): AnalysisPages {
  const actions = useProject((s) => s.actions);
  const openId = useProject((s) => s.currentId);
  const [state, setState] = useState<{ pages: BookPage[] | null; error: string }>({
    pages: null,
    error: "",
  });
  useEffect(() => {
    if (!open) return;
    let current = true;
    setState({ pages: null, error: "" });
    actions.readPages().then(
      (pages) => current && setState({ pages, error: "" }),
      (e) => current && setState({ pages: null, error: errText(e) }),
    );
    return () => {
      current = false;
    };
  }, [open, actions]);
  return { ...state, openId };
}
