import { bridge, type InstalledFont } from "../bridge";

/** The slice of the `FontFace` API the loader uses, so tests can stand in for the browser. */
export interface FaceLike {
  load: () => Promise<unknown>;
}
export interface FontEnv {
  installed: () => Promise<InstalledFont[]>;
  data: (id: string, file: string) => Promise<Uint8Array>;
  /** Makes a face from a `data:` URL; null when the webview has no FontFace. */
  createFace: (family: string, url: string, style: string, weight: string) => FaceLike | null;
  register: (face: FaceLike) => void;
}

const browserEnv: FontEnv = {
  installed: () => bridge.fontsInstalled(),
  data: (id, file) => bridge.fontsData(id, file),
  createFace: (family, url, style, weight) =>
    typeof FontFace === "undefined"
      ? null
      : new FontFace(family, `url(${url})`, { style, weight, display: "swap" }),
  register: (face) => document.fonts.add(face as FontFace),
};

const WEIGHTS: [RegExp, string][] = [
  [/thin/i, "100"],
  [/extralight|ultralight/i, "200"],
  [/light/i, "300"],
  [/semibold|demibold/i, "600"],
  [/extrabold|ultrabold/i, "800"],
  [/black|heavy/i, "900"],
  [/bold/i, "700"],
  [/medium/i, "500"],
];

/** Style and weight of a font file, read from its name (`Lora-Italic[wght].ttf`, `Inter-SemiBold.otf`); a variable file covers every weight. */
export function faceDescriptor(file: string): { style: string; weight: string } {
  const style = /italic|oblique/i.test(file) ? "italic" : "normal";
  if (/\[[^\]]*wght/i.test(file)) return { style, weight: "100 900" };
  return { style, weight: WEIGHTS.find(([re]) => re.test(file))?.[1] ?? "400" };
}

/** Base64 of the bytes, in chunks so a large font does not overflow the call stack. */
export function toDataUrl(bytes: Uint8Array, file: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const mime = /\.otf$/i.test(file) ? "font/otf" : "font/ttf";
  return `data:${mime};base64,${btoa(bin)}`;
}

const loading = new Map<string, Promise<boolean>>();

async function load(family: string, env: FontEnv): Promise<boolean> {
  const font = (await env.installed()).find((f) => f.family === family);
  // Not one of the app's own fonts: a font installed on the computer, which the webview finds by its family name.
  if (!font) return true;
  const faces: FaceLike[] = [];
  for (const file of font.files) {
    if (!/\.(ttf|otf)$/i.test(file)) continue; // the licence text
    const { style, weight } = faceDescriptor(file);
    const face = env.createFace(
      family,
      toDataUrl(await env.data(font.id, file), file),
      style,
      weight,
    );
    if (!face) return false;
    await face.load();
    faces.push(face);
  }
  faces.forEach((f) => env.register(f));
  return faces.length > 0;
}

/**
 * Makes the editor able to draw `family`: a downloaded or imported family is registered as an `@font-face` from its bytes (once per
 * family), an installed one needs nothing. Resolves false, never rejects, when it cannot be loaded; the caller keeps the default stack.
 */
export function ensureFontLoaded(family: string, env: FontEnv = browserEnv): Promise<boolean> {
  const known = loading.get(family);
  if (known) return known;
  const p = load(family, env).catch(() => false);
  loading.set(family, p);
  // A failure is not remembered, so the next call can try again.
  void p.then((ok) => {
    if (!ok) loading.delete(family);
  });
  return p;
}

/** Forgets what was loaded (a deleted family must be looked up again). For tests and after Delete. */
export const forgetLoadedFonts = (): void => loading.clear();
