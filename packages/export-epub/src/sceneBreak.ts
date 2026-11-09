import { sceneBreakOrnament, type SceneBreakOrnamentId } from "@cadabracraft/shared";

const cssString = (s: string): string => s.replace(/[\\"]/g, "\\$&");

/**
 * The rule that draws a chosen scene-break ornament, appended after the template's stylesheet so it wins. Absent means nothing
 * is appended: the template's own rule stays exactly as it was, which is the default. Throws for an id the library does not list.
 */
export function sceneBreakCss(id: SceneBreakOrnamentId | undefined): string {
  if (id === undefined) return "";
  return `\nhr.scene-break:after{content:"${cssString(sceneBreakOrnament(id).glyph)}"}`;
}
