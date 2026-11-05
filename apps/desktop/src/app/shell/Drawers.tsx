import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { overlayClass, panelClass } from "../../ui/Dialog";
import { cx } from "../../ui/cx";
import { CommentsPanel } from "../comments/CommentsPanel";
import { ReferencesPanel } from "../references/ReferencesPanel";
import { ScenesPanel } from "../scenes/ScenesPanel";
import { Sidebar } from "./Sidebar";

/** The chapter list as a sheet (bottom on phones, left on tablets), for widths where the sidebar is hidden. */
export function ChaptersDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={cx(overlayClass, "lg:hidden")} />
        <D.Content
          aria-describedby={undefined}
          className={cx(
            panelClass,
            "inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-lg bg-sidebar lg:hidden",
            "md:inset-y-0 md:inset-s-0 md:inset-e-auto md:max-h-none md:w-80 md:rounded-none",
          )}
        >
          <D.Title className="sr-only">{t`Chapters`}</D.Title>
          <div className="flex justify-end px-2 pt-2">
            <D.Close asChild>
              <IconButton icon={X} label={t`Close chapters`} />
            </D.Close>
          </div>
          <Sidebar onNavigate={() => onOpenChange(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The references panel as a sheet (bottom on phones, right on tablets), for widths where the side panel is hidden. */
export function ReferencesSheet({
  open,
  onOpenChange,
  openId,
  onOpenId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openId: string | null;
  onOpenId: (id: string) => void;
}) {
  const { t } = useLingui();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={cx(overlayClass, "xl:hidden")} />
        <D.Content
          aria-describedby={undefined}
          className={cx(
            panelClass,
            "inset-x-0 bottom-0 h-[80dvh] overflow-hidden rounded-t-lg bg-surface xl:hidden",
            "md:inset-y-0 md:inset-e-0 md:inset-s-auto md:h-auto md:w-100 md:rounded-none md:border-e-0",
          )}
        >
          <D.Title className="sr-only">{t`References`}</D.Title>
          <ReferencesPanel
            onClose={() => onOpenChange(false)}
            openId={openId}
            onOpen={(id) => {
              onOpenChange(false);
              onOpenId(id);
            }}
          />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The scenes panel as a sheet (bottom on phones, right on tablets), where the sidebar and side panel are hidden. */
export function ScenesSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={cx(overlayClass, "xl:hidden")} />
        <D.Content
          aria-describedby={undefined}
          className={cx(
            panelClass,
            "inset-x-0 bottom-0 h-[80dvh] overflow-hidden rounded-t-lg bg-surface xl:hidden",
            "md:inset-y-0 md:inset-e-0 md:inset-s-auto md:h-auto md:w-80 md:rounded-none md:border-e-0",
          )}
        >
          <D.Title className="sr-only">{t`Scenes`}</D.Title>
          <ScenesPanel onClose={() => onOpenChange(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The comments rail as a sheet (bottom on phones, right on tablets), where the side panel is hidden. */
export function CommentsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={cx(overlayClass, "xl:hidden")} />
        <D.Content
          aria-describedby={undefined}
          className={cx(
            panelClass,
            "inset-x-0 bottom-0 h-[80dvh] overflow-hidden rounded-t-lg bg-surface xl:hidden",
            "md:inset-y-0 md:inset-e-0 md:inset-s-auto md:h-auto md:w-100 md:rounded-none md:border-e-0",
          )}
        >
          <D.Title className="sr-only">{t`Comments`}</D.Title>
          <CommentsPanel onClose={() => onOpenChange(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
