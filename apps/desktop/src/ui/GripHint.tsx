import { useId } from "react";
import { useLingui } from "@lingui/react/macro";

/**
 * How a reorder grip is used, as text a screen reader reads with the grip (aria-describedby), not a hover-only
 * title (WCAG 1.4.13). Put `hint` anywhere in the row and `describedBy` on the grip.
 */
export function useGripHint() {
  const { t } = useLingui();
  const id = useId();
  const hint = (
    <span id={id} className="sr-only">
      {t`Drag, or press the up and down arrow keys`}
    </span>
  );
  return { describedBy: id, hint };
}
