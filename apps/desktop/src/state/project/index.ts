import { create } from "zustand";
import { createAssetActions } from "./assets";
import { createAudioActions } from "./audio";
import { createCommentActions } from "./comments";
import { createContext } from "./context";
import { createEditionActions } from "./editions";
import { createExportActions } from "./exports";
import { createFontActions } from "./fonts";
import { createHistoryActions } from "./history";
import { createPageActions } from "./pages";
import { createProjectActions } from "./project";
import { createReferenceActions } from "./references";
import { createReplaceActions } from "./replace";
import { createSceneActions } from "./scenes";
import { createSnapshotActions } from "./snapshots";
import { createTocActions } from "./toc";
import { createTrashActions } from "./trash";
import { NO_HISTORY } from "./util";
import { createVoiceActions } from "./voices";
import type { ProjectState } from "./types";

export { COVER_EXTENSIONS } from "./types";
export type {
  AudioChapterState,
  AudioExportOptions,
  AudioJob,
  BookDetails,
  BookPage,
  History,
  HistoryEntry,
  FontDownload,
  PdfExportOptions,
  PdfStage,
  Recovery,
  ReferenceImport,
  ReferenceNotice,
  TrashItem,
  VoiceDownload,
} from "./types";
export { AUTOSAVE_MS, AUTOSAVE_MAX_MS } from "./util";

/**
 * The open book and everything in progress around it. One zustand store, built from slices that each own a group of
 * actions (project, pages, history, trash, snapshots, replace, assets, exports, audio, voices) over shared helpers in `context.ts`.
 */
export const useProject = create<ProjectState>((set, get) => {
  const ctx = createContext(set, get);
  return {
    root: null,
    opening: null,
    manifest: null,
    currentId: null,
    currentDoc: null,
    activeLanguage: null,
    notice: "",
    alertNotice: "",
    hashes: {},
    draft: null,
    reloadCount: 0,
    importReport: null,
    exportStage: null,
    audio: null,
    voiceDownload: null,
    fontDownloads: {},
    trash: [],
    history: NO_HISTORY,
    recovery: [],
    comments: [],
    commentsPageId: null,
    referenceNotices: [],
    removedReferences: [],
    referenceImport: null,
    actions: {
      ...createProjectActions(ctx),
      ...createPageActions(ctx),
      ...createEditionActions(ctx),
      ...createHistoryActions(ctx),
      ...createTrashActions(ctx),
      ...createSnapshotActions(ctx),
      ...createReplaceActions(ctx),
      ...createSceneActions(ctx),
      ...createAssetActions(ctx),
      ...createReferenceActions(ctx),
      ...createTocActions(ctx),
      ...createExportActions(ctx),
      ...createAudioActions(ctx),
      ...createVoiceActions(ctx),
      ...createFontActions(ctx),
      ...createCommentActions(ctx),
    },
  };
});
