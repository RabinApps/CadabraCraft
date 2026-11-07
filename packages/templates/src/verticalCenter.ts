import type { MatterKind } from "@cadabracraft/shared";
import type { Template } from "./types";

/** A page's own choice: `true` centred, `false` at the top, or absent to follow the template. */
export interface VerticalCenterChoice {
  verticalCenter?: boolean;
}

/** Pages with a layout of their own (a generated list, the imprint at the foot): never centred, whatever the author or the template says. */
const OWN_LAYOUT: readonly MatterKind[] = ["contents", "copyright"];

/**
 * Whether a front or back matter page sits in the vertical middle of the page: the page's own choice, else whether the template
 * centres that kind. `kind` is undefined for a chapter, which never centres, nor do the contents and copyright pages.
 */
export const resolveVerticalCenter = (
  template: Pick<Template, "print">,
  kind: MatterKind | undefined,
  entry: VerticalCenterChoice,
): boolean =>
  kind !== undefined &&
  !OWN_LAYOUT.includes(kind) &&
  (entry.verticalCenter ?? template.print.matter.verticalCenter.includes(kind));
