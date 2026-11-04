import {
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  PanelRight,
  Redo2,
  Undo2,
  type LucideIcon,
} from "lucide-react";

/** Icons whose meaning is a direction along the reading axis: they mirror in right-to-left layouts. */
const DIRECTIONAL: ReadonlySet<LucideIcon> = new Set([
  // Alignment is stored as start and end, so in a right-to-left book the start is on the right.
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  PanelRight,
  Undo2,
  Redo2,
]);

/** The class that mirrors `icon` in a right-to-left layout, or nothing for icons that must not flip (media, logos, symbols). */
export const mirrorClass = (icon: LucideIcon): string | undefined =>
  DIRECTIONAL.has(icon) ? "rtl:-scale-x-100" : undefined;
