import { t } from "@lingui/core/macro";
import type { SceneStatus } from "../../lib/scenes/scenes";

/** The word for a scene's status, and for a scene that has none yet. */
export function sceneStatusWord(status: SceneStatus): string {
  if (status === "outline") return t`Outline`;
  if (status === "draft") return t`Draft`;
  if (status === "revised") return t`Revised`;
  if (status === "final") return t`Final`;
  return t`No status`;
}

/** The tone of a status pill and dot: a draft warns (it is not done), a revised or final scene is on its way or done. */
export function sceneStatusTone(status: SceneStatus): "warn" | "success" | "none" {
  if (status === "draft") return "warn";
  if (status === "revised" || status === "final") return "success";
  return "none";
}

export const sceneStatusDot: Record<SceneStatus, string> = {
  "": "bg-ink-muted/60",
  outline: "bg-ink-muted",
  draft: "bg-warn",
  revised: "bg-success",
  final: "bg-success",
};
