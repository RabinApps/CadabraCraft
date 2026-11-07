import { useEffect, useState, type DragEvent } from "react";
import { bridge } from "../../lib/bridge";
import { overEditor } from "../../lib/fileDrop";
import { parseDropped } from "../../lib/references/dropped";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";

/** True when a drag carries an address or text (not just files), which the web view reports as it passes over the panel. */
const carriesWebData = (e: DragEvent): boolean =>
  e.dataTransfer.types.includes("text/uri-list") || e.dataTransfer.types.includes("text/plain");

/**
 * While mounted, files dropped on the window (except over the editor, which adds a picture) are added as references, and
 * the panel shows that it will take what is over it. `targetProps` go on the panel: addresses and text dragged in from a page or from the editor become links and
 * a note (a platform that hands such drags to the window instead of the web view only ever drops files).
 */
export function useReferenceDrop() {
  const [filesOver, setFilesOver] = useState(false);
  const [webOver, setWebOver] = useState(false);
  useEffect(() => {
    // Files over the editor are the editor's (it adds a picture); everywhere else they are for the panel.
    const un = bridge.onFileDrag({
      active: (over, at) => setFilesOver(over && !overEditor(at)),
      drop: (paths, at) => {
        if (!overEditor(at)) attempt(useProject.getState().actions.addReferences(paths));
      },
    });
    return () => void un.then((f) => f());
  }, []);
  const targetProps = {
    onDragEnter: (e: DragEvent) => {
      if (!carriesWebData(e)) return;
      e.preventDefault();
      setWebOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!carriesWebData(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setWebOver(false);
    },
    onDrop: (e: DragEvent) => {
      setWebOver(false);
      if (!carriesWebData(e)) return;
      e.preventDefault();
      const { items, tooLong } = parseDropped({
        uriList: e.dataTransfer.getData("text/uri-list"),
        text: e.dataTransfer.getData("text/plain"),
      });
      if (items.length > 0 || tooLong)
        attempt(useProject.getState().actions.addDropped(items, tooLong));
    },
  };
  return { dropActive: filesOver || webOver, targetProps };
}
