import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import type { SupportForm } from "../../lib/support/supportForm";
import { Button } from "../../ui/Button";
import { Row, Section } from "./SettingsParts";
import { SupportFormDialog } from "./SupportFormDialog";

/** Settings > Help: the Contact and Feedback forms, each in a dialog. */
export function HelpSection({ title }: { title: string }) {
  const { t } = useLingui();
  const [form, setForm] = useState<SupportForm | null>(null);
  return (
    <>
      <Section id="help" title={title}>
        <Row
          title={t`Contact CadabraCraft`}
          hint={t`Ask a question or report a problem.`}
          control={<Button onClick={() => setForm("contact")}>{t`Contact`}</Button>}
        />
        <Row
          title={t`Give feedback`}
          hint={t`Say what works and what does not.`}
          control={<Button onClick={() => setForm("feedback")}>{t`Give feedback`}</Button>}
        />
      </Section>
      <SupportFormDialog form={form} onClose={() => setForm(null)} />
    </>
  );
}
