import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BookTableCell,
  BookTableHeader,
  CaptionedImage,
  Footnote,
  SceneBreak,
  SmallCaps,
  Subscript,
  Superscript,
  setAssetUrlResolver,
} from "../index";

// The extension configs hold plain functions; call them directly so no DOM is needed.
type Fn = (...a: never[]) => unknown;
const cfg = (ext: unknown) => (ext as { config: Record<string, Fn> }).config;
const call = (ext: unknown, key: string, ...args: unknown[]) =>
  (cfg(ext)[key] as unknown as (...a: unknown[]) => unknown)(...args);

describe("node and mark specs", () => {
  it.each([
    [SceneBreak, [{ tag: "hr.scene-break" }], ["hr", { class: "scene-break" }]],
    [Footnote, [{ tag: "span.footnote" }], ["span", { class: "footnote" }, 0]],
  ])("%# parse and render", (ext, parse, render) => {
    expect(call(ext, "parseHTML")).toEqual(parse);
    expect(call(ext, "renderHTML", { HTMLAttributes: {} })).toEqual(render);
  });

  it.each([
    [SmallCaps, "span.small-caps", "span", { class: "small-caps", id: "a" }],
    [Superscript, "sup", "sup", { id: "a" }],
    [Subscript, "sub", "sub", { id: "a" }],
  ])("%# mark parses %s and renders %s", (ext, tag, el, attrs) => {
    expect(call(ext, "parseHTML")).toEqual([{ tag }]);
    expect(call(ext, "renderHTML", { HTMLAttributes: { id: "a" } })).toEqual([el, attrs, 0]);
  });

  it.each([BookTableCell, BookTableHeader])("%# cells fix colspan and rowspan at 1", (ext) => {
    const attrs = call(ext, "addAttributes") as Record<
      string,
      { default: number; parseHTML: Fn; renderHTML: Fn }
    >;
    for (const k of ["colspan", "rowspan"]) {
      expect(attrs[k]!.default).toBe(1);
      expect((attrs[k]!.parseHTML as unknown as () => number)()).toBe(1);
      expect((attrs[k]!.renderHTML as unknown as () => object)()).toEqual({});
    }
  });
});

// Minimal DOM: just enough surface for the image node view.
class FakeEl {
  className = "";
  hidden = false;
  alt = "";
  src = "";
  textContent = "";
  attrs = new Set<string>();
  classes = new Set<string>();
  children: FakeEl[] = [];
  classList = { add: (c: string) => void this.classes.add(c) };
  constructor(public tag: string) {}
  append(...c: FakeEl[]) {
    this.children.push(...c);
  }
  removeAttribute(n: string) {
    this.attrs.add(`removed:${n}`);
    this.src = "";
  }
}

describe("image node view", () => {
  afterEach(() => {
    setAssetUrlResolver(null);
    vi.unstubAllGlobals();
  });

  const make = (attrs: Record<string, unknown>) => {
    vi.stubGlobal("document", { createElement: (t: string) => new FakeEl(t) });
    const factory = (
      cfg(CaptionedImage).addNodeView as unknown as () => (p: unknown) => {
        dom: FakeEl;
        update: (n: unknown) => boolean;
      }
    )();
    const type = {};
    const view = factory({ node: { type, attrs } });
    const [img, caption] = view.dom.children as [FakeEl, FakeEl];
    const next = (a: Record<string, unknown>, t: unknown = type) =>
      view.update({ type: t, attrs: a });
    return { view, img, caption, next };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("shows a plain src, alt and caption without a resolver", () => {
    const { view, img, caption } = make({ src: "https://x/a.png", alt: "A", title: "Cap" });
    expect(view.dom.tag).toBe("figure");
    expect(view.dom.className).toBe("book-image");
    expect(img.src).toBe("https://x/a.png");
    expect(img.alt).toBe("A");
    expect(caption.textContent).toBe("Cap");
    expect(caption.hidden).toBe(false);
  });

  it("defaults missing attrs and hides an empty caption", () => {
    const { img, caption } = make({});
    expect(img.src).toBe("");
    expect(img.alt).toBe("");
    expect(caption.hidden).toBe(true);
  });

  it("does not resolve a non-asset src, and skips work when src is unchanged", () => {
    const resolver = vi.fn(async (s: string) => `blob:${s}`);
    setAssetUrlResolver(resolver);
    const { img, next } = make({ src: "https://x/a.png" });
    expect(resolver).not.toHaveBeenCalled();
    expect(img.src).toBe("https://x/a.png");
    expect(next({ src: "https://x/a.png", title: "later" })).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("resolves an asset path through the registered resolver", async () => {
    setAssetUrlResolver(async (s) => `blob:${s}`);
    const { img } = make({ src: "assets/a.png" });
    await tick();
    expect(img.src).toBe("blob:assets/a.png");
  });

  it("ignores a stale resolution after the src changed", async () => {
    const pending: Record<string, (u: string) => void> = {};
    setAssetUrlResolver((s) => new Promise((r) => (pending[s] = r)));
    const { img, next } = make({ src: "assets/a.png" });
    next({ src: "https://x/b.png" });
    pending["assets/a.png"]!("blob:a");
    await tick();
    expect(img.src).toBe("https://x/b.png");
  });

  it("marks the image missing when the resolver rejects", async () => {
    setAssetUrlResolver(() => Promise.reject(new Error("gone")));
    const { img } = make({ src: "assets/a.png" });
    await tick();
    expect(img.attrs.has("removed:src")).toBe(true);
    expect(img.classes.has("missing-asset")).toBe(true);
  });

  it("updates in place for the same node type and refuses another type", () => {
    const { img, next } = make({ src: "a.png" });
    expect(next({ src: "b.png" })).toBe(true);
    expect(img.src).toBe("b.png");
    expect(next({ src: "c.png" }, {})).toBe(false);
    expect(img.src).toBe("b.png");
  });
});
