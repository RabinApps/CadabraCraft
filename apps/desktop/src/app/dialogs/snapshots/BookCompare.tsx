import { useLingui } from "@lingui/react/macro";
import { causeText } from "../../../lib/projectError";
import { Comparison } from "./Comparison";
import type { BookCompare as State } from "./compareBookPage";

/** This chapter in the selected book snapshot against the current text, with what to say when there is nothing to compare. */
export function BookCompare({ state, title }: { state: State; title: string }) {
  const { t } = useLingui();
  if (state.status === "idle") return null;
  const note = (text: string, alert = false) => (
    <p
      role={alert ? "alert" : "status"}
      className="m-0 rounded-md bg-surface px-3 py-2 text-sm text-ink-muted"
    >
      {text}
    </p>
  );
  if (state.status === "loading") return note(t`Comparing “${title}” with the snapshot…`);
  if (state.status === "missing") {
    return note(
      t`This snapshot has no copy of “${title}”, so there is nothing to compare or restore.`,
    );
  }
  if (state.status === "unreadable") {
    return note(
      t`This snapshot's copy of “${title}” could not be read as a chapter. Restoring the whole book may still work.`,
      true,
    );
  }
  if (state.status === "error") {
    return note(
      t`Could not compare “${title}” with the snapshot (${causeText(state.error)}). The rest of this dialog still works.`,
      true,
    );
  }
  return (
    <Comparison
      chosen={state.compared}
      label={t`Comparison of “${title}” with the snapshot`}
      note={
        state.gone ? (
          <p className="m-0 font-ui text-sm text-ink-muted">{t`This chapter is not in the book now, so everything the snapshot has counts as “In this version only”.`}</p>
        ) : null
      }
    />
  );
}
