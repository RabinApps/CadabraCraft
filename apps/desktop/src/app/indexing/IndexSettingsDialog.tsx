import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { defaultIndexSettings } from "@cadabracraft/format";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Checkbox } from "../../ui/forms/Checkbox";
import { Field } from "../../ui/forms/Input";
import { Segmented } from "../../ui/forms/Segmented";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";

/** How the generated index page looks and what it leaves out; saved in the book when the author presses Save. */
export function IndexSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLingui();
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t`Index settings`} size="md">
      {open && <Form onClose={onClose} />}
    </Modal>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const stored = useProject((s) => s.manifest?.index);
  const saved = stored ?? defaultIndexSettings();
  const actions = useProject((s) => s.actions);
  const [form, setForm] = useState(saved);
  const [shown, setShown] = useState(false);
  const bad = form.heading.trim() === "" || /[\r\n]/.test(form.heading);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (bad) return;
    const { hidden: _kept, ...rest } = form;
    attempt(actions.setIndexSettings({ ...rest, heading: form.heading.trim() }));
    onClose();
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Checkbox
        label={t`Add an index to the book`}
        hint={t`Written after the back matter in the EPUB, PDF, Markdown, Word and Rich Text exports.`}
        checked={form.enabled}
        onChange={(e) => set("enabled", e.target.checked)}
      />
      <Field
        label={t`Heading`}
        value={form.heading}
        error={shown && bad ? t`The index needs a heading.` : undefined}
        onChange={(e) => set("heading", e.target.value)}
      />
      <Segmented<"1" | "2">
        label={t`Columns`}
        value={String(form.columns) as "1" | "2"}
        onChange={(v) => set("columns", v === "1" ? 1 : 2)}
        items={[
          { value: "1", label: t`One column` },
          { value: "2", label: t`Two columns` },
        ]}
      />
      <Checkbox
        label={t`Show page ranges`}
        hint={t`Print 12–15 instead of 12, 13, 14, 15.`}
        checked={form.ranges}
        onChange={(e) => set("ranges", e.target.checked)}
      />
      <Checkbox
        label={t`Letter headings`}
        hint={t`A, B, C start each group.`}
        checked={form.letterHeadings}
        onChange={(e) => set("letterHeadings", e.target.checked)}
      />
      <Checkbox
        label={t`Hide terms used once`}
        hint={t`Leaves out terms with one place and no sub-entries or cross-references.`}
        checked={form.hideSingles}
        onChange={(e) => set("hideSingles", e.target.checked)}
      />
      <section aria-label={t`Hidden terms`} className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-ink-muted">{t`Hidden terms`}</h3>
        {saved.hidden.length === 0 ? (
          <p className="text-sm text-ink-muted">{t`No terms are hidden. Hide one from its entry in the Index panel.`}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {saved.hidden.map((h) => (
              <li key={h} className="flex items-center gap-2 rounded-md bg-bg p-2">
                <span className="min-w-0 flex-1 truncate font-book">{h}</span>
                <Button
                  size="sm"
                  aria-label={t`Show ${h} in the index again`}
                  onClick={() => attempt(actions.setIndexTermHidden(h, false))}
                >
                  {t`Show again`}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex justify-end gap-2.5">
        <Button onClick={onClose}>{t`Cancel`}</Button>
        <Button type="submit" variant="primary">
          {t`Save`}
        </Button>
      </div>
    </form>
  );
}
