import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { useProject } from "../state/project/index";
import { focusField } from "../ui/forms/Input";
import type { ImageDraft } from "./toolbar/ToolbarDialogs";

/** State and actions of the Add image / Image details dialog: pick a file, edit the selected image, insert or save with its alt text. */
export function useImageDialog(editor: Editor, chain: () => ReturnType<Editor["chain"]>) {
  const { t } = useLingui();
  const [image, setImage] = useState<ImageDraft | null>(null);
  const importImage = useProject((p) => p.actions.importImage);
  const addImage = async () => {
    const src = await importImage();
    if (src) setImage({ src, alt: "", caption: "", decorative: false, editing: false });
  };
  const editImage = () => {
    const a = editor.getAttributes("image");
    setImage({
      src: String(a.src ?? ""),
      alt: String(a.alt ?? ""),
      caption: String(a.title ?? ""),
      decorative: a.decorative === true,
      editing: true,
    });
  };
  const applyImage = () => {
    if (!image) return;
    const alt = image.decorative ? "" : image.alt.trim();
    if (!image.decorative && alt === "") {
      setImage({ ...image, error: t`Describe the image, or tick "This image is decorative".` });
      focusField("image-alt");
      return;
    }
    const attrs = { alt, decorative: image.decorative, title: image.caption.trim() || null };
    if (image.editing) chain().updateAttributes("image", attrs).run();
    else
      chain()
        .insertContent({ type: "image", attrs: { src: image.src, ...attrs } })
        .run();
    setImage(null);
  };
  return { image, setImage, addImage, editImage, applyImage };
}
