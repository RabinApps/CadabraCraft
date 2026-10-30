import { useLingui } from "@lingui/react/macro";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Modal } from "../ui/Dialog";
import { Field } from "../ui/Input";
import { Notice } from "../ui/Notice";

export interface ImageDraft {
  src: string;
  alt: string;
  caption: string;
  /** The image conveys nothing, so it has no description on purpose. */
  decorative: boolean;
  /** Editing an image already in the chapter rather than inserting a new one. */
  editing: boolean;
  /** Shown when Insert/Save was refused. */
  error?: string;
}

/** The dialog that asks for alt text (or a decorative flag) and a caption when an image is inserted or edited. */
export function ImageDialog({
  image,
  setImage,
  onInsert,
}: {
  image: ImageDraft | null;
  setImage: (update: ImageDraft | null | ((i: ImageDraft | null) => ImageDraft | null)) => void;
  onInsert: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      open={image !== null}
      onOpenChange={() => setImage(null)}
      title={image?.editing ? t`Image details` : t`Add image`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onInsert();
        }}
      >
        <Field label={t`Image file`} value={image?.src ?? ""} readOnly />
        <Field
          label={t`Description (alt text)`}
          value={image?.decorative ? "" : (image?.alt ?? "")}
          disabled={image?.decorative ?? false}
          onChange={(e) => setImage((i) => i && { ...i, alt: e.target.value, error: undefined })}
          hint={t`Read aloud by screen readers. Describe what the picture shows.`}
          autoFocus
        />
        <Checkbox
          label={t`This image is decorative`}
          hint={t`It adds nothing to the text, so screen readers skip it.`}
          checked={image?.decorative ?? false}
          onChange={(e) =>
            setImage((i) => i && { ...i, decorative: e.target.checked, error: undefined })
          }
        />
        <Field
          label={t`Caption`}
          value={image?.caption ?? ""}
          onChange={(e) => setImage((i) => i && { ...i, caption: e.target.value })}
          hint={t`Optional. Shown below the image.`}
        />
        {image?.error && <Notice role="alert">{image.error}</Notice>}
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => setImage(null)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">
            {image?.editing ? t`Save` : t`Insert`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The dialog that asks for a link address and shows why an address was refused. */
export function LinkDialog({
  open,
  onOpenChange,
  href,
  setHref,
  error,
  clearError,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  href: string;
  setHref: (href: string) => void;
  error: string;
  clearError: () => void;
  onApply: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t`Add link`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
      >
        <Field
          label={t`Address`}
          value={href}
          onChange={(e) => {
            setHref(e.target.value);
            clearError();
          }}
          hint={t`Use http, https or mailto.`}
          autoFocus
        />
        {error && <Notice role="alert">{error}</Notice>}
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">{t`Apply`}</Button>
        </div>
      </form>
    </Modal>
  );
}
