import { File, FileText, Image, Music, StickyNote, Video, type LucideIcon } from "lucide-react";
import type { Reference } from "@cadabracraft/format";
import { useLingui } from "@lingui/react/macro";
import { referenceKind, type ReferenceKind } from "../../lib/referenceKinds";
import { cx } from "../../ui/cx";

const ICONS: Record<ReferenceKind, LucideIcon> = {
  image: Image,
  video: Video,
  audio: Music,
  pdf: FileText,
  text: StickyNote,
  other: File,
};

export const kindIcon = (kind: ReferenceKind): LucideIcon => ICONS[kind];

/** The kind's name for the author ("Image", "PDF", "Document"). */
export function useKindLabel(): (kind: ReferenceKind) => string {
  const { t } = useLingui();
  return (kind) =>
    ({
      image: t`Image`,
      video: t`Video`,
      audio: t`Audio`,
      pdf: t`PDF`,
      text: t`Document`,
      other: t`File`,
    })[kind];
}

interface Props {
  reference: Reference;
  selected?: boolean;
  onOpen: () => void;
}

/** One reference in the list: a type icon, the title, and the kind with its tags. Opens the viewer. */
export function ReferenceRow({ reference, selected, onOpen }: Props) {
  const kind = referenceKind(reference.file);
  const Icon = kindIcon(kind);
  const label = useKindLabel();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={reference.title}
      className={cx(
        "flex w-full items-center gap-3 rounded-md border p-2.5 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected
          ? "border-accent bg-accent-soft"
          : "border-border bg-surface hover:bg-accent-soft/60",
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{reference.title}</span>
        <span className="block truncate text-xs text-ink-muted">
          {[label(kind), ...reference.tags].join(" · ")}
        </span>
      </span>
    </button>
  );
}
