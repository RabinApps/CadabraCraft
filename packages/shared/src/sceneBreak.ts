/**
 * Scene-break ornaments the author can choose for a book (`sceneBreak` in cadabra.json). The id is what the book stores;
 * `glyph` is what the PDF and the EPUB stylesheet draw; `text` is the plain-text mark Word, RTF and Markdown write.
 * Absent in the book means the template's own glyph, which stays as it is for every exporter that had one.
 */
export const SCENE_BREAK_ORNAMENT_IDS = [
  "asterism",
  "three-dots",
  "fleuron",
  "dinkus",
  "em-dash",
  "none",
] as const;

export type SceneBreakOrnamentId = (typeof SCENE_BREAK_ORNAMENT_IDS)[number];

export interface SceneBreakOrnament {
  glyph: string;
  text: string;
}

export const SCENE_BREAK_ORNAMENTS: Readonly<Record<SceneBreakOrnamentId, SceneBreakOrnament>> = {
  asterism: { glyph: "⁂", text: "⁂" },
  "three-dots": { glyph: "*   *   *", text: "* * *" },
  fleuron: { glyph: "❦", text: "❦" },
  dinkus: { glyph: "•", text: "•" },
  "em-dash": { glyph: "—", text: "—" },
  none: { glyph: "", text: "" },
};

export class SceneBreakOrnamentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneBreakOrnamentError";
  }
}

export const isSceneBreakOrnamentId = (v: unknown): v is SceneBreakOrnamentId =>
  typeof v === "string" && (SCENE_BREAK_ORNAMENT_IDS as readonly string[]).includes(v);

/** Throws `SceneBreakOrnamentError` for an id the library does not list (exporters never fall back silently). */
export function sceneBreakOrnament(id: string): SceneBreakOrnament {
  if (!isSceneBreakOrnamentId(id))
    throw new SceneBreakOrnamentError(`Unknown scene-break ornament "${id}"`);
  return SCENE_BREAK_ORNAMENTS[id];
}

/** The mark the PDF and the EPUB draw: the chosen ornament's glyph, else the template's own glyph. */
export function sceneBreakGlyph(templateGlyph: string, id: string | undefined): string {
  return id === undefined ? templateGlyph : sceneBreakOrnament(id).glyph;
}

/** The plain-text mark a Word, RTF or Markdown export writes: the chosen ornament's text, else the exporter's own default. */
export function sceneBreakText(fallback: string, id: string | undefined): string {
  return id === undefined ? fallback : sceneBreakOrnament(id).text;
}
