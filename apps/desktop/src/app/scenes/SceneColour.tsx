import { labelColour, type ColourBy, type LabelColour } from "../../lib/scenes/sceneFilter";
import type { SceneRow } from "../../lib/scenes/scenes";
import { cx } from "../../ui/cx";
import { sceneStatusDot } from "./labels";

/** Whole class names, so Tailwind finds them. */
const dot: Record<LabelColour, string> = {
  accent: "bg-accent",
  warn: "bg-warn",
  success: "bg-success",
};

/** The class of the colour bar for a scene under the chosen "Colour by", or null when it has nothing to show. */
export function colourBarClass(scene: SceneRow, by: ColourBy): string | null {
  if (by === "label") {
    const c = labelColour(scene.label);
    return c && dot[c];
  }
  if (by === "status") return scene.status ? sceneStatusDot[scene.status] : null;
  return null;
}

/** A 4px bar along the start edge of a card (the card is `relative`). The meaning is always printed too: the label chip and the status. */
export function ColourBar({ scene, by }: { scene: SceneRow; by: ColourBy }) {
  const cls = colourBarClass(scene, by);
  if (!cls) return null;
  return (
    <span
      aria-hidden
      data-colour-bar={by}
      className={cx("absolute inset-y-0 start-0 w-1 rounded-s-lg", cls)}
    />
  );
}

/** The scene's label as a chip: a dot in the label's colour and the label itself, so colour is never the only signal. */
export function LabelChip({ label }: { label: string }) {
  const colour = labelColour(label);
  if (!colour) return null;
  return (
    <span
      data-label-chip
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-micro font-semibold text-ink-muted"
    >
      <span aria-hidden className={cx("size-2 shrink-0 rounded-full", dot[colour])} />
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}
