import { errText } from "../lib/projectError";
import { useProject } from "./project/index";

/**
 * Runs a store action from an event handler that cannot await it: a failure becomes the visible notice instead of an
 * unhandled rejection. Returns nothing; the action itself keeps its own result for callers that do await it.
 */
export function attempt(promise: Promise<unknown>): void {
  promise.catch((e: unknown) => useProject.setState({ notice: errText(e) }));
}

/** Shows any promise rejection nobody handled as the notice, so a failure is never silent. Returns the function that removes the listener. */
export function installRejectionNotice(
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const onRejection = (e: PromiseRejectionEvent) => {
    e.preventDefault();
    useProject.setState({ notice: errText(e.reason) });
  };
  target.addEventListener("unhandledrejection", onRejection);
  return () => target.removeEventListener("unhandledrejection", onRejection);
}
