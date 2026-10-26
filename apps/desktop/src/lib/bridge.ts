import { invoke } from "@tauri-apps/api/core";
import type { ChapterDoc } from "@cadabracraft/shared";

/** Thin wrapper over the Tauri commands in src-tauri/src/commands. */
export const loadChapter = (path: string) => invoke<ChapterDoc | null>("load_chapter", { path });
export const saveChapter = (path: string, doc: ChapterDoc) => invoke<void>("save_chapter", { path, doc });
export const saveBytes = (path: string, bytes: number[]) => invoke<void>("save_bytes", { path, bytes });
