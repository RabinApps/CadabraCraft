import { useState } from "react";
import type { ExportFormat } from "../../export/exportFormat";

/** The Export dialog: whether it is open and on which format. */
export function useExportControl() {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("epub");
  const openExport = (next: ExportFormat) => {
    setFormat(next);
    setOpen(true);
  };
  return { open, setOpen, format, setFormat, openExport };
}

export type ExportControl = ReturnType<typeof useExportControl>;

/** The reference viewer and the sheets that stand in for the side panels on a narrow window. */
export function useBookOverlays() {
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [refsSheet, setRefsSheet] = useState(false);
  const [commentsSheet, setCommentsSheet] = useState(false);
  const [scenesSheet, setScenesSheet] = useState(false);
  return {
    viewingId,
    setViewingId,
    refsSheet,
    setRefsSheet,
    commentsSheet,
    setCommentsSheet,
    scenesSheet,
    setScenesSheet,
  };
}

export type BookOverlays = ReturnType<typeof useBookOverlays>;
