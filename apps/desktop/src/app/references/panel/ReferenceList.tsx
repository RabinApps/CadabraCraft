import type { Reference } from "@cadabracraft/format";
import { attempt } from "../../../state/attempt";
import { useProject } from "../../../state/project/index";
import { DropLine } from "../../../ui/DropLine";
import { cx } from "../../../ui/cx";
import { ReferenceRow } from "../ReferenceRow";
import { openLink } from "../TextReferenceViews";
import { useReferenceReorder } from "./useReferenceReorder";

interface Props {
  /** Every reference, in the saved order (what a drag reorders). */
  references: Reference[];
  /** The ones to show: filtered and sorted. */
  shown: Reference[];
  grid: boolean;
  /** Rows have grips and can be moved (nothing is filtered, the order is the saved one, and the list is not a grid). */
  reorderable: boolean;
  /** Something is being dragged over the panel: the list dims. */
  dropActive: boolean;
  openId?: string | null | undefined;
  onOpen: (id: string) => void;
  /** A link could not be opened; gets the reason (empty when a new try starts). */
  onLinkError: (message: string) => void;
}

/** The rows of the panel, with the drop line and the grips that reorder them. */
export function ReferenceList({
  references,
  shown,
  grid,
  reorderable,
  dropActive,
  openId,
  onOpen,
  onLinkError,
}: Props) {
  const actions = useProject((s) => s.actions);
  const { drag, list, grab, refocus } = useReferenceReorder(references);
  return (
    <ul
      ref={list}
      className={cx(
        grid ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2",
        dropActive && "opacity-40",
      )}
    >
      {shown.map((r, i) => (
        <li key={r.id} data-ref-id={r.id} className="relative min-w-0">
          {drag && drag.at === i && <DropLine />}
          {drag && drag.at === shown.length && i === shown.length - 1 && <DropLine below />}
          <div>
            <ReferenceRow
              reference={r}
              selected={r.id === openId}
              onOpen={() => onOpen(r.id)}
              onRemove={() => attempt(actions.removeReference(r.id))}
              onOpenLink={(url) => {
                onLinkError("");
                openLink(url, onLinkError);
              }}
              {...(reorderable
                ? {
                    reorder: {
                      onGrab: grab(r.id, i),
                      onMove: (d: number) => {
                        refocus.current = r.id;
                        attempt(actions.moveReference(r.id, i + d));
                      },
                      first: i === 0,
                      last: i === shown.length - 1,
                      dragging: drag?.id === r.id,
                    },
                  }
                : {})}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
