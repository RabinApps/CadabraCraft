import { validateGoal, type BookGoal, type Manifest } from "@cadabracraft/format";
import type { ProjectActions } from "../types";
import type { Ctx } from "../context";

/** The book's writing goal in cadabra.json: saved, changed or removed from the Writing goal dialog. */
export const createGoalActions = (ctx: Ctx): Pick<ProjectActions, "setBookGoal"> => {
  const { need, saveManifest } = ctx;
  return {
    async setBookGoal(goal: BookGoal | null) {
      const { manifest } = need();
      if (goal === null) {
        if (!("goal" in manifest)) return;
        const { goal: _old, ...rest } = manifest;
        await saveManifest(rest);
        return;
      }
      // Validated here as well as in the dialog: the manifest rules own the limits. An unchanged goal writes nothing.
      const next: Manifest = { ...manifest, goal: validateGoal(goal) };
      if (JSON.stringify(next) === JSON.stringify(manifest)) return;
      await saveManifest(next);
    },
  };
};
