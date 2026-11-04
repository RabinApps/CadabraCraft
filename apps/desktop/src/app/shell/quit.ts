import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "@lingui/core/macro";
import { createCloseHandler } from "./closeGuard";
import { useProject } from "../../state/project/index";
import { alertOf } from "../../state/project/util";

/**
 * The one close handler, shared by the window's close request and the Quit menu item, so a failed save is remembered
 * across both ("ask again to leave without the changes"). The predefined Quit item of the native menu ends the process
 * without a close request, so it would skip the flush; Quit is therefore an ordinary command that goes through here.
 */
export const closeRequest = createCloseHandler(
  {
    hasUnsaved: () => useProject.getState().draft !== null,
    flush: () => useProject.getState().actions.flush(),
    onSaveFailed: (message) =>
      useProject.setState(
        alertOf(
          t`Your last changes could not be saved (${message}). Close the window again to leave without them, or free some space and try again.`,
        ),
      ),
  },
  () => getCurrentWindow().destroy(),
);

/**
 * Quits the app after writing unsaved typing; with a failed save it stays open and a second request leaves anyway.
 * A close request that is not held back means "let the window close", which here is our own job: nothing else will.
 */
export async function quitApp(): Promise<void> {
  let held = false;
  await closeRequest({
    preventDefault: () => {
      held = true;
    },
  });
  if (!held) await getCurrentWindow().destroy();
}
