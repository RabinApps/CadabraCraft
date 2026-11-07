import { Suspense, lazy, useState, type ComponentProps } from "react";
import { useProject } from "../../../state/project/index";

// The import dialogs pull in the .docx, Markdown and outline parsers (several hundred KB), so they load the first time
// one is opened instead of with the app.
const ImportDialogChunk = lazy(() =>
  import("./ImportDialogs").then((m) => ({ default: m.ImportDialog })),
);
const ImportReportChunk = lazy(() =>
  import("./ImportDialogs").then((m) => ({ default: m.ImportReportDialog })),
);

type ImportDialogProps = ComponentProps<typeof ImportDialogChunk>;

/** `ImportDialog`, loaded on first open and kept mounted afterwards. */
export function ImportDialog(props: ImportDialogProps) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <ImportDialogChunk {...props} />
    </Suspense>
  );
}

/** `ImportReportDialog`, loaded when the first import report appears. */
export function ImportReportDialog() {
  const hasReport = useProject((s) => s.importReport !== null);
  const [seen, setSeen] = useState(hasReport);
  if (hasReport && !seen) setSeen(true);
  if (!seen) return null;
  return (
    <Suspense fallback={null}>
      <ImportReportChunk />
    </Suspense>
  );
}
