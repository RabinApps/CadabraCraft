import { t } from "@lingui/core/macro";
import { whyText } from "../lib/projectError";
import { alertOf } from "./project/util";
import { useProject } from "./project/index";

/**
 * Runs a store action from an event handler that cannot await it: a failure becomes the visible notice instead of an
 * unhandled rejection. Returns nothing; the action itself keeps its own result for callers that do await it.
 */
export function attempt(promise: Promise<unknown>): void {
  promise.catch((e: unknown) => {
    const why = whyText(e);
    useProject.setState(alertOf(t`That did not work: ${why}. Try again.`));
  });
}

/** Shows any promise rejection nobody handled as the notice, so a failure is never silent. Returns the function that removes the listener. */
export function installRejectionNotice(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const onRejection = (e: PromiseRejectionEvent) => {
    e.preventDefault();
    const why = whyText(e.reason);
    useProject.setState(
      alertOf(
        t`Something went wrong: ${why}. Try again, or restart CadabraCraft if it keeps happening.`,
      ),
    );
  };
  target.addEventListener("unhandledrejection", onRejection);
  return () => target.removeEventListener("unhandledrejection", onRejection);
}
