import { useLingui } from "@lingui/react/macro";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Dialog";
import { Field } from "../ui/Input";
import { Notice } from "../ui/Notice";

export interface ImageDraft {
  src: string;
  alt: string;
  caption: string;
}

/** The dialog that asks for alt text and a caption before an image is inserted. */
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
    <Modal open={image !== null} onOpenChange={() => setImage(null)} title={t`Add image`}>
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
          value={image?.alt ?? ""}
          onChange={(e) => setImage((i) => i && { ...i, alt: e.target.value })}
          hint={t`Read aloud by screen readers. Leave empty only for decoration.`}
          autoFocus
        />
        <Field
          label={t`Caption`}
          value={image?.caption ?? ""}
          onChange={(e) => setImage((i) => i && { ...i, caption: e.target.value })}
          hint={t`Optional. Shown below the image.`}
        />
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => setImage(null)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">{t`Insert`}</Button>
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
