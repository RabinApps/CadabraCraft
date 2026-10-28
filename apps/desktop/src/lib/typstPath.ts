import { readStored, removeStored, writeStored } from "./persisted";

const TYPST_PATH_KEY = "cadabracraft.typstPath";
/** App preference only (an absolute path), never stored in project files. */
export const readTypstPath = (): string => readStored(TYPST_PATH_KEY) ?? "";
export const saveTypstPath = (p: string): void => {
  if (p) writeStored(TYPST_PATH_KEY, p);
  else removeStored(TYPST_PATH_KEY);
};
