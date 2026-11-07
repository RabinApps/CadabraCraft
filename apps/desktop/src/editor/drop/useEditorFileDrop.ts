import { useEffect, useRef, useState } from "react";
import { plural, t } from "@lingui/core/macro";
import { bridge } from "../../lib/bridge";
import { overEditor } from "../../lib/fileDrop";
import { baseName } from "../../lib/paths";

/** The image types `import_asset` accepts (`IMAGE_EXTENSIONS` in src-tauri/src/project/assets.rs). */
export const DROP_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

/** True when the file name ends in a supported image type. A folder has no such name (the host refuses it anyway). */
export const isImagePath = (path: string): boolean => {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && DROP_IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
};

/** How long the warning stays when the author does nothing. */
export const DROP_WARNING_MS = 8000;

/**
 * Files dragged from the desktop onto the page: `over` while they are over the editor (for the drop highlight), and on a
 * drop the first image goes to `startImage` (which opens the Add image dialog, where alt text is still required). Other
 * files, and files of a type that cannot be added, leave a `warning`. Does nothing while `enabled` is false (a blank
 * page, Read mode), and never acts on files over the References panel, which owns those (`overEditor`).
 */
export function useEditorFileDrop(enabled: boolean, startImage: (path: string) => Promise<boolean>) {
  const [over, setOver] = useState(false);
  const [warning, setWarning] = useState("");
  const start = useRef(startImage);
  start.current = startImage;
  useEffect(() => {
    if (!enabled) return;
    const un = bridge.onFileDrag({
      active: (isOver, at) => {
        const here = isOver && overEditor(at);
        setOver(here);
        if (here) setWarning("");
      },
      drop: (paths, at) => {
        if (!overEditor(at)) return;
        const image = paths.find(isImagePath);
        if (!image) {
          setWarning(t`This file type can't be added here.`);
          return;
        }
        const skipped = paths.length - 1;
        setWarning(
          skipped > 0
            ? plural(skipped, {
                one: "Only one picture is added at a time. # other file was left out.",
                other: "Only one picture is added at a time. # other files were left out.",
              })
            : "",
        );
        void start.current(image);
      },
    });
    return () => void un.then((f) => f());
  }, [enabled]);
  useEffect(() => {
    if (!warning) return;
    const id = setTimeout(() => setWarning(""), DROP_WARNING_MS);
    return () => clearTimeout(id);
  }, [warning]);
  return { over: enabled && over, warning };
}
