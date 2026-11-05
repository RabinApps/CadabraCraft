import Image from "@tiptap/extension-image";
import { isAssetPath } from "@cadabracraft/shared";

type AssetUrlResolver = (src: string) => Promise<string>;
let assetUrlResolver: AssetUrlResolver | null = null;

/**
 * The webview cannot load a project-relative `assets/...` path, so the app registers a resolver that turns it into a
 * displayable (blob) URL. Stored JSON always keeps the relative path; only the node view swaps what the `<img>` shows.
 */
export function setAssetUrlResolver(fn: AssetUrlResolver | null): void {
  assetUrlResolver = fn;
}

/** Block image with a caption (stored in `title`) and an asset-aware node view. */
export const CaptionedImage = Image.extend({
  /** `decorative: true` marks an image that conveys nothing (empty alt on purpose); absent means false. */
  addAttributes() {
    return {
      ...this.parent?.(),
      decorative: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-decorative") === "true",
        renderHTML: (attrs) => (attrs.decorative ? { "data-decorative": "true" } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node: initial }) => {
      const dom = document.createElement("figure");
      dom.className = "book-image";
      const img = document.createElement("img");
      const caption = document.createElement("figcaption");
      dom.append(img, caption);
      let shownSrc: string | null = null;
      const render = (attrs: Record<string, unknown>) => {
        const src = String(attrs.src ?? "");
        img.alt = attrs.decorative ? "" : String(attrs.alt ?? "");
        caption.textContent = String(attrs.title ?? "");
        caption.hidden = !attrs.title;
        if (src === shownSrc) return;
        shownSrc = src;
        if (assetUrlResolver && isAssetPath(src)) {
          assetUrlResolver(src).then(
            (url) => {
              if (shownSrc === src) img.src = url;
            },
            () => {
              img.removeAttribute("src");
              img.classList.add("missing-asset");
            },
          );
        } else {
          img.src = src;
        }
      };
      render(initial.attrs);
      return {
        dom,
        update(next) {
          if (next.type !== initial.type) return false;
          render(next.attrs);
          return true;
        },
      };
    };
  },
});
