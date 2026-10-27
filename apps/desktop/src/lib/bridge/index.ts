import { assetsBridge } from "./assets";
import { audioBridge } from "./audio";
import { dialogBridge } from "./dialog";
import { exportBridge } from "./export";
import { projectBridge } from "./project";
import { systemBridge } from "./system";
import { watchBridge } from "./watch";

export * from "./types";

/** Thin wrapper over the Tauri commands in src-tauri/src/commands, one file per area. All paths are relative to the project root. */
export const bridge = {
  ...dialogBridge,
  ...assetsBridge,
  ...systemBridge,
  ...projectBridge,
  ...watchBridge,
  ...exportBridge,
  ...audioBridge,
};
export type Bridge = typeof bridge;
