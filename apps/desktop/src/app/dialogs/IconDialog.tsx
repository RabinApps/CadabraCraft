import { useLingui } from "@lingui/react/macro";
import { Modal } from "../../ui/Dialog";
import { cx } from "../../ui/cx";
import { useIconChoices } from "../../lib/useIconChoices";
import { useProject } from "../../state/project/index";
import { attempt } from "../../state/attempt";

export interface IconPage {
  id: string;
  title: string;
  icon?: string;
}

const choiceClass =
  "flex min-h-11 flex-col items-center justify-center gap-1 rounded-md border border-border px-1 py-2 text-center text-small text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:bg-accent-soft";

/** Picks the sidebar icon of a page: one button per allowed icon, plus None. The choice is saved at once and the dialog closes. */
export function IconDialog({ page, onClose }: { page: IconPage | null; onClose: () => void }) {
  const { t } = useLingui();
  const actions = useProject((s) => s.actions);
  const choices = useIconChoices();
  const pick = (icon: string | null) => {
    if (page) attempt(actions.setIcon(page.id, icon));
    onClose();
  };
  return (
    <Modal
      open={page !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t`Icon for “${page?.title ?? ""}”`}
      description={t`Shown beside the title in the chapter list. It is not part of the exported book.`}
      size="md"
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
        <button
          type="button"
          aria-pressed={!page?.icon}
          className={cx(choiceClass, "col-span-full")}
          onClick={() => pick(null)}
        >
          {t`None`}
        </button>
        {choices.map(({ name, Icon, label }) => (
          <button
            key={name}
            type="button"
            aria-pressed={page?.icon === name}
            className={choiceClass}
            onClick={() => pick(name)}
          >
            <Icon size={20} aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
