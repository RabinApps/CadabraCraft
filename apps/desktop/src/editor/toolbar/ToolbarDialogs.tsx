import { useLingui } from "@lingui/react/macro";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/forms/Checkbox";
import { Modal } from "../../ui/Dialog";
import { Field } from "../../ui/forms/Input";
import { Notice } from "../../ui/feedback/Notice";
import { Select } from "../../ui/forms/Select";
import { isLangTag } from "@cadabracraft/shared";
import { ENABLED_LOCALE_INFO } from "../../i18n/locales";

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

const NO_IMAGE: ImageDraft = { src: "", alt: "", caption: "", decorative: false, editing: false };

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
  const d = image ?? NO_IMAGE;
  return (
    <Modal
      open={image !== null}
      onOpenChange={() => setImage(null)}
      title={d.editing ? t`Image details` : t`Add image`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onInsert();
        }}
      >
        <Field label={t`Image file`} value={d.src} readOnly />
        <Field
          label={t`Description (alt text)`}
          value={d.decorative ? "" : d.alt}
          disabled={d.decorative}
          onChange={(e) => setImage((i) => i && { ...i, alt: e.target.value, error: undefined })}
          hint={t`Read aloud by screen readers. Describe what the picture shows.`}
          id="image-alt"
          errorId={d.error ? "image-error" : undefined}
          autoFocus
        />
        <Checkbox
          label={t`This image is decorative`}
          hint={t`It adds nothing to the text, so screen readers skip it.`}
          checked={d.decorative}
          onChange={(e) =>
            setImage((i) => i && { ...i, decorative: e.target.checked, error: undefined })
          }
        />
        <Field
          label={t`Caption`}
          value={d.caption}
          onChange={(e) => setImage((i) => i && { ...i, caption: e.target.value })}
          hint={t`Optional. Shown below the image.`}
        />
        {d.error && (
          <Notice id="image-error" role="alert">
            {d.error}
          </Notice>
        )}
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => setImage(null)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">
            {d.editing ? t`Save` : t`Insert`}
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
          id="link-address"
          errorId={error ? "link-error" : undefined}
          autoFocus
        />
        {error && (
          <Notice id="link-error" role="alert">
            {error}
          </Notice>
        )}
        <div className="flex justify-end gap-2.5">
          <Button onClick={() => onOpenChange(false)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">{t`Apply`}</Button>
        </div>
      </form>
    </Modal>
  );
}

export interface LangDraft {
  /** The BCP 47 tag being typed or picked. */
  tag: string;
  /** The text at the caret already carries a language mark, so it can be cleared. */
  current: boolean;
  /** Shown when Apply was refused. */
  error?: string;
}

/** The dialog that sets the language of the selected passage (WCAG 3.1.2): a pick from the enabled languages or any BCP 47 tag. */
export function LangDialog({
  draft,
  setDraft,
  onApply,
  onClear,
}: {
  draft: LangDraft | null;
  setDraft: (update: LangDraft | null | ((d: LangDraft | null) => LangDraft | null)) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const tag = draft?.tag ?? "";
  const known = ENABLED_LOCALE_INFO.some((l) => l.code === tag);
  // The error is about the tag unless the tag is fine and only the selection is missing.
  const tagInvalid = Boolean(draft?.error) && !isLangTag(tag.trim());
  return (
    <Modal
      open={draft !== null}
      onOpenChange={() => setDraft(null)}
      title={t`Language of selection`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onApply();
        }}
      >
        <Select
          label={t`Language`}
          value={known ? tag : ""}
          onChange={(e) =>
            setDraft((d) => d && { ...d, tag: e.target.value || d.tag, error: undefined })
          }
        >
          <option value="">{t`Other (use the Language tag field)`}</option>
          {ENABLED_LOCALE_INFO.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName} ({l.code})
            </option>
          ))}
        </Select>
        <Field
          label={t`Language tag`}
          value={tag}
          onChange={(e) => setDraft((d) => d && { ...d, tag: e.target.value, error: undefined })}
          hint={t`A BCP 47 tag such as fr, fr-CA or zh-Hans. Screen readers and exports use it to pronounce and hyphenate the passage.`}
          id="lang-tag"
          errorId={tagInvalid ? "lang-error" : undefined}
          autoFocus
        />
        {draft?.error && (
          <Notice id="lang-error" role="alert">
            {draft.error}
          </Notice>
        )}
        <div className="flex justify-end gap-2.5">
          {draft?.current && <Button onClick={onClear}>{t`Clear language`}</Button>}
          <Button onClick={() => setDraft(null)}>{t`Cancel`}</Button>
          <Button type="submit" variant="primary">{t`Apply`}</Button>
        </div>
      </form>
    </Modal>
  );
}
