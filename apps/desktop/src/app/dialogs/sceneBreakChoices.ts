import { t as translate } from "@lingui/core/macro";
import {
  SCENE_BREAK_ORNAMENTS,
  SCENE_BREAK_ORNAMENT_IDS,
  type SceneBreakOrnamentId,
} from "@cadabracraft/shared";
import { getTemplate, listTemplates } from "@cadabracraft/templates";

/** The name of a scene-break ornament in the author's language. */
export function ornamentName(id: SceneBreakOrnamentId): string {
  switch (id) {
    case "asterism":
      return translate`Asterism`;
    case "three-dots":
      return translate`Three dots`;
    case "fleuron":
      return translate`Fleuron`;
    case "dinkus":
      return translate`Dinkus`;
    case "em-dash":
      return translate`Em dash`;
    case "none":
      return translate`No mark`;
  }
}

/** The menu value of "Template default": choosing it removes `sceneBreak` from the book. */
export const TEMPLATE_DEFAULT_CHOICE = "default";

/** The menu value for a stored choice (absent = template default). */
export const choiceValue = (value: SceneBreakOrnamentId | null): string =>
  value ?? TEMPLATE_DEFAULT_CHOICE;

/** The stored choice for a menu value (`null` removes the key). */
export const choiceFromValue = (value: string): SceneBreakOrnamentId | null =>
  value === TEMPLATE_DEFAULT_CHOICE ? null : (value as SceneBreakOrnamentId);

/** One ornament row of the menu. */
export interface OrnamentRow {
  id: SceneBreakOrnamentId;
  name: string;
  glyph: string;
}

export const ornamentRows = (): OrnamentRow[] =>
  SCENE_BREAK_ORNAMENT_IDS.map((id) => ({
    id,
    name: ornamentName(id),
    glyph: SCENE_BREAK_ORNAMENTS[id].glyph,
  }));

/** One read-only row of "Ornament by template": the template's name and its own mark. */
export interface TemplateMarkRow {
  id: string;
  name: string;
  glyph: string;
}

export const templateMarkRows = (): TemplateMarkRow[] =>
  listTemplates().map((t) => ({ id: t.id, name: t.name, glyph: t.print.sceneBreak.glyph }));

/** What the menu button shows: the chosen mark and its name, or the template's mark for "Template default". */
export function triggerText(
  value: SceneBreakOrnamentId | null,
  templateId: string,
): { glyph: string; name: string } {
  if (value === null) {
    return {
      glyph: getTemplate(templateId).print.sceneBreak.glyph,
      name: translate`Template default`,
    };
  }
  return { glyph: SCENE_BREAK_ORNAMENTS[value].glyph, name: ornamentName(value) };
}
