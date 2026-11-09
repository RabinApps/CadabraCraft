import { useProject } from "../../state/project";
import { useViewMode } from "../../state/view/viewMode";

/** The Show link of an export check: closes the dialog, then opens the editor in Write at the page the check names. */
export function useShowCheckedPage(close: () => void): (pageId: string) => void {
  const selectChapter = useProject((s) => s.actions.selectChapter);
  const setMode = useViewMode((s) => s.setMode);
  return (pageId) => {
    close();
    setMode("write");
    void selectChapter(pageId);
  };
}
