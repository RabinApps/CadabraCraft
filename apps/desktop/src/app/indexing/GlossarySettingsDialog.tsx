import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { defaultGlossarySettings } from "@cadabracraft/format";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Dialog";
import { Checkbox } from "../../ui/forms/Checkbox";
import { Field } from "../../ui/forms/Input";
import { Segmented } from "../../ui/forms/Segmented";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";

/** How the glossary page looks and behaves; saved in the book when the author presses Save. */
export function GlossarySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLingui();
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t`Glossary settings`} size="md">
      {open && <Form onClose={onClose} />}
    </Modal>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const stored = useProject((s) => s.manifest?.glossary);
  const saved = stored ?? defaultGlossarySettings();
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
    const { entries: _entries, ...rest } = form;
    attempt(actions.setGlossarySettings({ ...rest, heading: form.heading.trim() }));
    onClose();
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Checkbox
        label={t`Add a glossary to the book`}
        hint={t`Written after the index. Terms with no definition are left out.`}
        checked={form.enabled}
        onChange={(e) => set("enabled", e.target.checked)}
      />
      <Field
        label={t`Heading`}
        value={form.heading}
        error={shown && bad ? t`The glossary needs a heading.` : undefined}
        onChange={(e) => set("heading", e.target.value)}
      />
      <Segmented<"alpha" | "added">
        label={t`Order`}
        value={form.order}
        onChange={(v) => set("order", v)}
        items={[
          { value: "alpha", label: t`A to Z` },
          { value: "added", label: t`Order added` },
        ]}
      />
      <Checkbox
        label={t`Show terms with no definition`}
        hint={t`In the Glossary panel. They are never printed.`}
        checked={form.showUndefined}
        onChange={(e) => set("showUndefined", e.target.checked)}
      />
      <Checkbox
        label={t`List glossary terms in the index`}
        hint={t`Each place a term is marked also appears in the index.`}
        checked={form.inIndex}
        onChange={(e) => set("inIndex", e.target.checked)}
      />
      <Checkbox
        label={t`Mark first use`}
        hint={t`In the EPUB, the first use of a term in each chapter links to its entry.`}
        checked={form.markFirstUse}
        onChange={(e) => set("markFirstUse", e.target.checked)}
      />
      <div className="flex justify-end gap-2.5">
        <Button onClick={onClose}>{t`Cancel`}</Button>
        <Button type="submit" variant="primary">
          {t`Save`}
        </Button>
      </div>
    </form>
  );
}
