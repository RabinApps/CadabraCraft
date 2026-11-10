import { useProject } from "../../state/project/index";
import { requestMarkJump, type MarkJump } from "../../state/pages/markJump";
import { attempt } from "../../state/attempt";

/** Opens the page a mark is on and selects the marked words: the editor takes the request when its page is shown. */
export function useGoTo(): (jump: MarkJump) => void {
  const actions = useProject((s) => s.actions);
  return (jump) => {
    requestMarkJump(jump);
    if (useProject.getState().currentId !== jump.chapterId)
      attempt(actions.selectChapter(jump.chapterId));
  };
}
