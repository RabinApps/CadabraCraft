import { useEffect } from "react";
import { bridge } from "../../lib/bridge";
import { attempt } from "../../state/attempt";
import { useProject } from "../../state/project/index";

/** While mounted, files dropped on the window are added as references. */
export function useReferenceDrop(): void {
  useEffect(() => {
    const un = bridge.onFilesDropped((paths) =>
      attempt(useProject.getState().actions.addReferences(paths)),
    );
    return () => void un.then((f) => f());
  }, []);
}
