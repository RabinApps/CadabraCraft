import type { Manifest, Reference, Tree } from "@cadabracraft/format";
import type { AudioFormat } from "@cadabracraft/export-audio";
import type { PageReport, TrimSize } from "@cadabracraft/export-pdf";
import type { ChapterDoc, MatterKind } from "@cadabracraft/shared";
import type { PublishingForm } from "../../lib/publishingForm";
import type { ImportChoices, ImportReport } from "../../lib/importBook";
import type { BookSearchOptions } from "../../lib/search/bookSearch";
import type { ManuscriptFont } from "@cadabracraft/export-docx";
import type { AudioUiError } from "../../lib/audioErrors";
import type { FontUiError } from "../../lib/fontErrors";
import type { RemovedReference } from "../../lib/referenceKinds";
import type { PreviewTarget } from "../../lib/previewTarget";

export interface PdfExportOptions extends ExportScope {
  trimSize: TrimSize;
  pdfA: boolean;
  /** Template id; saved in the manifest when it differs from the current one. */
  template: string;
  /** Put the book's cover (if it has one) first, as a full-page image. Default true. */
  cover?: boolean;
  /** Print fonts for this export. Default: the book's own choice (`manifest.fonts`). */
  fonts?: { body?: string; heading?: string };
  /** Bleed in inches (KDP: 0.125); the page grows past the trim on the top, bottom and outside edges. Default none. */
  bleedIn?: number;
  /** Crop marks outside the bleed; needs `bleedIn` > 0 and grows the page on every side. */
  cropMarks?: boolean;
}

export interface AudioExportOptions {
  voice: string;
  /** 0.5 to 2; 1 is normal. */
  speed: number;
  formats: AudioFormat[];
  /** Only these chapters (default: every chapter, not front or back matter). */
  chapterIds?: string[];
  /** The edition to read aloud (a BCP 47 tag); default: the source edition. Files go to `exports/<language>/audio`. */
  language?: string;
  /** Leave out chapters that are not translated into `language` yet. Without it they stop the export, like the other formats. */
  skipUntranslated?: boolean;
}

export interface AudioChapterState {
  id: string;
  title: string;
  state: "waiting" | "rendering" | "done" | "empty" | "failed";
  /** 0..1 while rendering. */
  progress: number;
}

/** The audiobook export in progress or just finished. It lives in the store, not the dialog, so the dialog can close while it runs. */
export interface AudioJob {
  status: "running" | "done" | "error";
  chapters: AudioChapterState[];
  /** 0..1 across all chapters. */
  overall: number;
  /** Cancel was pressed and the engine is being stopped. */
  cancelling: boolean;
  durationSec: number;
  files: number;
  /** The folder the files go to (`exports/<language>/audio`). */
  dir: string;
  /** Every chapter is rendered and the book's M4B is being joined and encoded. */
  packing: boolean;
  error: AudioUiError | null;
}

/** A voice download in progress or just failed. It lives in the store so the dialog can be closed and reopened while it runs. */
export interface VoiceDownload {
  status: "running" | "error";
  /** Bytes present of everything being downloaded. */
  done: number;
  total: number;
  cancelling: boolean;
  error: AudioUiError | null;
}

/** A font download in progress or just failed, by catalog id. It lives in the store so the catalog can be closed and reopened while it runs. */
export interface FontDownload {
  status: "running" | "error";
  /** Bytes present of the whole family. */
  done: number;
  total: number;
  cancelling: boolean;
  error: FontUiError | null;
}

/** A page in the project trash, with a title for the list. */
export interface TrashItem {
  path: string;
  original: string;
  title: string;
  /** `YYYYMMDD-HHMM` (UTC). */
  trashedAt: string;
}

/**
 * One undoable chapter-tree edit: the tree before and after, and the page file it created or removed (if any).
 * Plain data. While the file is in the trash, `trashPath` says where, so undo and redo can move it back.
 */
export interface HistoryEntry {
  label: string;
  before: Tree;
  after: Tree;
  /** `added`: the edit made the page exist (add, add page, restore); otherwise it moved the page to the trash. */
  file?: { path: string; added: boolean };
  trashPath?: string;
  /** The removed page's files in other languages (the translation editions), moved to the trash with it. */
  others?: { language: string; path: string; trashPath?: string }[];
  /** The reference links the removed page had (`reference` -> `chapter` is the page's id), put back by undo and dropped again by redo. */
  links?: { reference: string; chapter: string }[];
  /** A removed reference: what it was and where in the list, and while its file is in the trash, where (undo moves it back). `before` and `after` trees are equal. */
  reference?: { item: Reference; index: number; trashPath?: string };
  /** A text edit across pages (Replace all in the whole book): the pages' file text before and after. `before` and `after` trees are equal. */
  docs?: { file: string; before: string; after: string }[];
}

export interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/** A page whose newest snapshot is newer than the saved page and differs from it (see `find_stale_pages`). */
export interface Recovery {
  id: string;
  title: string;
  file: string;
  /** Project-relative path of the newer snapshot. */
  snapshot: string;
}

/** A message about a reference import that stays until dismissed: a duplicate that was reused (`warn`) or a file that was refused (`danger`). */
export interface ReferenceNotice {
  tone: "warn" | "danger";
  text: string;
}

/** The file being imported right now (1-based `index` of `total`), shown as progress in the References panel. */
export interface ReferenceImport {
  name: string;
  index: number;
  total: number;
}

/** The book fields the Book details dialog edits. */
export interface BookDetails {
  title: string;
  author: string;
  language: string;
  isbn: string;
  identifier: string;
  cover: string | null;
  /** Print page size of the book (shared by every edition). Absent keeps what the book has. */
  trimSize?: TrimSize;
  /** Retail details of this edition. Absent keeps what the edition has. */
  publishing?: PublishingForm;
}

/** Cover images the exporters can place: png, jpg, jpeg and webp (not gif or svg). */
export const COVER_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

export type PdfStage = "preparing" | "rendering" | "saving";

/** A page of the book in reading order, with its chapter document. */
export interface BookPage {
  id: string;
  title: string;
  doc: ChapterDoc;
  section: "front" | "chapter" | "back";
  kind?: MatterKind;
}
/** The whole project store: the open book, what is in progress, and the actions that change them. */
export interface ProjectState {
  root: string | null;
  /** A project open that is still running (name from the recent list or the folder name); the shell shows the loading skeleton. Null when none is. */
  opening: { root: string; name: string } | null;
  manifest: Manifest | null;
  currentId: string | null;
  /** Loaded content of the current chapter; the editor owns edits until saveCurrent. */
  currentDoc: ChapterDoc | null;
  notice: string;
  hashes: Record<string, string>;
  /** Unsaved editor content for the current chapter; flushed before switching chapters or exporting. */
  draft: ChapterDoc | null;
  /** Bumped when the current chapter is reloaded from disk so the editor remounts with the new content. */
  reloadCount: number;
  /** Result of the last import, shown in a dialog until dismissed. */
  importReport: ImportReport | null;
  /** Set while an EPUB or PDF export runs. */
  exportStage: PdfStage | null;
  /** The audiobook export (running, finished or failed); null when none has run or it was dismissed. */
  audio: AudioJob | null;
  /** The voice download (running, or failed and waiting for a retry); null when none is active. */
  voiceDownload: VoiceDownload | null;
  /** The font downloads that are running or failed (waiting for a retry), by catalog id. */
  fontDownloads: Record<string, FontDownload>;
  /** Restorable pages in the project trash, newest first (filled by `refreshTrash`). */
  trash: TrashItem[];
  /** Undo and redo stacks for chapter-tree edits (the editor's own text undo is separate). Cleared on open and external reload. */
  history: History;
  /** The edition the editor shows and writes (a BCP 47 tag); null means the source edition. Reset when a book opens or closes. */
  activeLanguage: string | null;
  /** What the last reference import said about files it reused or refused; empty when nothing is pending. */
  referenceNotices: ReferenceNotice[];
  /** Reference files in the project trash (removed from the book), newest first; refreshed by `refreshRemovedReferences`. */
  removedReferences: RemovedReference[];
  /** The reference import in progress, or null. */
  referenceImport: ReferenceImport | null;
  /** Pages offered for recovery when the book was opened, one dialog at a time; entries leave when restored or dismissed. */
  recovery: Recovery[];
  actions: ProjectActions &
    PageActions &
    HistoryActions &
    TrashActions &
    SnapshotActions &
    ReplaceActions &
    AssetActions &
    ReferenceActions &
    ExportActions &
    AudioActions &
    VoiceActions &
    FontActions &
    EditionActions;
}

export interface ReferenceActions {
  /** Imports files into `references/` and lists them in the book. Without `paths` it asks the author to pick files. Duplicates and refused files become `referenceNotices`; nothing throws. */
  addReferences: (paths?: string[]) => Promise<void>;
  /** Changes a reference's title, note, tags or linked pages. Failures set `notice`. */
  /** Reads the project trash for removed reference files. Failures leave the list as it was. */
  refreshRemovedReferences: () => Promise<void>;
  /** Moves a removed reference file back and lists it again, titled from its file name. Returns the error text to show, or null when it worked. */
  restoreReference: (trashPath: string) => Promise<string | null>;
  /** Puts a reference at position `to` of the list and saves. */
  moveReference: (id: string, to: number) => Promise<void>;
  updateReference: (
    id: string,
    patch: Partial<Pick<Reference, "title" | "note" | "tags" | "chapters">>,
  ) => Promise<void>;
  /** Takes a reference out of the book and moves its file to the project trash. */
  removeReference: (id: string) => Promise<void>;
  dismissReferenceNotices: () => void;
}

export interface EditionActions {
  /** Shows another edition in the editor and the chapter list. Unsaved typing is saved first. Throws when the book has no such edition. */
  setLanguage: (language: string) => Promise<void>;
  /** Adds an edition in `language` and switches to it. `copy` starts every chapter as the source text, `empty` as blank pages; either way every chapter is untranslated until the author writes it. */
  addLanguage: (language: string, mode: "copy" | "empty") => Promise<void>;
}

export interface ProjectActions {
  externalChange: (path: string) => Promise<void>;
  /** The file watcher failed: tell the author that edits made outside the app may not show up. */
  watchFailed: () => void;
  openProject: (root: string) => Promise<void>;
  /** Saves unsaved typing, then leaves the open book (back to the start screen). Nothing on disk changes. */
  closeProject: () => Promise<void>;
  createProject: (
    root: string,
    title: string,
    author: string,
    trimSize?: TrimSize,
  ) => Promise<void>;
  /** Imports a .docx/.md file into a NEW project in `root` (the source is only read), opens it and sets `importReport`. Throws, having created nothing, when the file cannot be imported. */
  importBook: (
    sourcePath: string,
    root: string,
    title: string,
    author: string,
    opts?: ImportChoices,
  ) => Promise<void>;
  /** Appends the chosen chapters of an import source to the OPEN book (existing chapters and files are never overwritten), opens the first new one and sets `importReport`. Throws, having left the chapter list unchanged, when it fails. */
  importIntoBook: (sourcePath: string, opts?: ImportChoices) => Promise<void>;
  dismissImportReport: () => void;
  /** Sets the book's template (cadabra.json). A no-op when it is already set. */
  setTemplate: (id: string) => Promise<void>;
  /** Saves the book's print fonts (`manifest.fonts`). A missing or empty key means the template's own font; no key at all removes `fonts`. A no-op when nothing changes. */
  setBookFonts: (fonts: { body?: string; heading?: string }) => Promise<void>;
  /** Saves the book details (cadabra.json) of `edition` (default: the source; a translation keeps its language). Trims text; an empty ISBN becomes null. Throws (a message for the author) when the title, author, language or identifier is empty or the cover is not an `assets/` image. */
  updateDetails: (details: BookDetails, edition?: string) => Promise<void>;
}

export interface PageActions {
  /** Saves unsaved typing, if any, without reloading the chapter. */
  flush: () => Promise<void>;
  /** Opens any page (front matter, chapter or back matter) in the editor. */
  selectChapter: (id: string) => Promise<void>;
  setDraft: (doc: ChapterDoc) => void;
  saveCurrent: (doc: ChapterDoc) => Promise<void>;
  add: (title: string) => Promise<void>;
  /** Adds a front or back matter page of `kind` with generated starter content and opens it. Throws when a limited kind (title page, copyright) already exists. */
  addMatter: (section: "front" | "back", kind: MatterKind, title?: string) => Promise<void>;
  /** Rename, move and remove work on chapters, front matter and back matter alike (`id` decides). */
  rename: (id: string, title: string) => Promise<void>;
  move: (id: string, delta: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Every page in reading order (of `language`, default the open edition) with its chapter document, for previews and checks. Reads the files from disk; unsaved typing is flushed first. */
  readPages: (language?: string) => Promise<BookPage[]>;
  /** Words in all chapters (front and back matter excluded). Pages whose file is unchanged since they were last counted are not read again; the open page is counted from memory. */
  bookWords: () => Promise<number>;
  /** Words of each chapter before the entry `id` in reading order (front and back matter excluded), for Page view's page numbers. */
  chapterWordsBefore: (id: string) => Promise<number[]>;
}

export interface HistoryActions {
  /** Reverts the latest chapter-tree edit (add, rename, move, trash, add page, restore). Added pages go to the trash, trashed pages come back from it. Resolves to false when there is nothing to undo or it failed (see `notice`). */
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
}

export interface TrashActions {
  /** Reloads `trash` from the project folder. */
  refreshTrash: () => Promise<void>;
  /** Moves a trashed page back, adds it to the end of its section and opens it. Never overwrites an existing page (a taken file name gets a `-2` suffix). */
  restoreTrash: (path: string) => Promise<void>;
}

export interface SnapshotActions {
  /** Puts an earlier version of a page back and opens the page. The text it replaces is kept as a snapshot first, so this can be undone from History. */
  restoreSnapshot: (id: string, snapshot: string) => Promise<void>;
  /** Puts one page back from a whole-book snapshot and opens it. The text it replaces is kept as a page snapshot first. */
  restorePageFromBook: (id: string, snapshot: string) => Promise<void>;
  /**
   * Puts the whole book (chapter list and every page) back from a whole-book snapshot, then opens the book again. Saves unsaved
   * typing first; Rust keeps an automatic snapshot of the book as it was, and moves pages the snapshot did not have to the trash.
   */
  restoreBook: (snapshot: string) => Promise<void>;
  /** Stops offering a page for recovery until the book is opened again. */
  dismissRecovery: (id: string) => void;
}

export interface ReplaceActions {
  /**
   * Replaces every match in every page (front and back matter too) and returns how many were replaced. Saves unsaved
   * typing first, writes the changed pages through the normal save path (backup, temp file and rename), reloads the open
   * page, and records ONE book undo step (Undo/Redo, Mod+Alt+Z) that restores or reapplies all of those pages.
   */
  replaceInBook: (opts: BookSearchOptions, replacement: string) => Promise<number>;
}

export interface AssetActions {
  /** Asks for a cover image (png, jpg or webp), copies it into assets/ and returns `assets/<name>`. Null if cancelled or refused (refusals set `notice`). Does not change the manifest. */
  importCover: () => Promise<string | null>;
  /** Asks for an image file, copies it into assets/, and returns `assets/<name>` (null if cancelled or refused; refusals set `notice`). */
  importImage: () => Promise<string | null>;
}

/** Which edition an export reads (default: the source) and whether untranslated pages are left out instead of stopping it. Output goes to `exports/<language>/`. */
export interface ExportScope {
  language?: string;
  skipUntranslated?: boolean;
}

export interface ExportActions {
  exportEpub: (scope?: ExportScope) => Promise<void>;
  /** Writes the whole book as exports/<language>/book.md. With `htmlMarks` false it throws `MarkdownExportError` (naming the chapter) at the first underline, small caps, superscript or subscript. */
  exportMarkdown: (options: { htmlMarks: boolean } & ExportScope) => Promise<void>;
  /** Writes the whole book as exports/<language>/manuscript.docx in standard manuscript format. Throws a `DocxExportError` message that names the page (and node) it cannot write. */
  exportDocx: (options: { font: ManuscriptFont } & ExportScope) => Promise<void>;
  /** Writes the whole book as exports/<language>/manuscript.rtf in the same manuscript format. Throws an `RtfExportError` message that names the page (and node) it cannot write, for example a GIF, WebP or SVG image. */
  exportRtf: (options: { font: ManuscriptFont } & ExportScope) => Promise<void>;
  /** Builds exports/<language>/book.pdf with Typst. Throws `PdfUiError` (message for the author, `code` for the dialog). */
  exportPdf: (options: PdfExportOptions) => Promise<void>;
  /**
   * Asks Typst for where each page entry starts and how long the book is, for the book as it is now (the open page's draft
   * included), without producing a PDF or taking the export lock. The last result is reused while the content is unchanged.
   */
  measurePages: () => Promise<PageReport>;
  /**
   * Typesets the book as it is now (the open page's draft included, the cover first when there is one) into a PDF that is kept in
   * memory only, for the print preview. `trimSize` overrides the book's size for this run. The last few results are reused while
   * the content and options are unchanged. Throws `PdfUiError`.
   */
  renderPreview: (options: PreviewOptions) => Promise<Uint8Array>;
  /**
   * Where the text at the top of page `page` of the preview's PDF is (a page entry, a block of it and perhaps a word), from a Typst
   * layout of the same run with the same options. The last layout is reused while the content and options are unchanged. Null when
   * the book has no pages. Throws `PdfUiError`.
   */
  previewTarget: (options: PreviewOptions & { page: number }) => Promise<PreviewTarget | null>;
}

export interface PreviewOptions {
  trimSize?: TrimSize;
  bleedIn?: number;
  cropMarks?: boolean;
}

export interface AudioActions {
  /**
   * Reads every chapter of one edition aloud with a local voice into exports/<language>/audio/, one chapter at a time on a worker thread (the page stays
   * responsive). Progress and the outcome are in `audio`; a render failure does not throw, it sets `audio.error` (and `audio.status`).
   * Throws only when it cannot start: another export is running, or the book has no chapters.
   */
  exportAudio: (options: AudioExportOptions) => Promise<void>;
  /**
   * Renders a few sentences of the first chosen chapter and resolves to WAV bytes, or null when stopped. Nothing is
   * written to the project. Rejects with a readable message (no voice, no text, engine failure).
   */
  hearAudioSample: (options: {
    voice: string;
    speed: number;
    chapterIds?: string[];
    language?: string;
    skipUntranslated?: boolean;
  }) => Promise<Uint8Array | null>;
  /** Stops a running sample. */
  cancelAudioSample: () => void;
  /** Stops the audiobook: the engine is killed and finished chapters are kept. */
  cancelAudio: () => void;
  /** Clears a finished or failed audiobook from `audio`. A running one is left alone. */
  dismissAudio: () => void;
}

export interface VoiceActions {
  /**
   * Downloads the given voice packs (skipping files already there; a stopped or failed download resumes). Progress and failure are
   * in `voiceDownload`. Resolves true when every pack finished; false when it was stopped or failed (not an exception).
   */
  downloadVoices: (packs: { id: string; bytes: number }[]) => Promise<boolean>;
  /** Stops the voice download; what was fetched is kept for a retry. */
  cancelVoiceDownload: () => void;
  /** Clears a failed or stopped voice download. A running one is left alone. */
  dismissVoiceDownload: () => void;
}

export interface FontActions {
  /**
   * Downloads a catalog family (a stopped or failed download resumes). Progress and failure are in `fontDownloads[id]`; a stopped one
   * leaves no entry. Resolves true when the family is installed; false when it was stopped, failed or already running (not an exception).
   */
  downloadFont: (id: string, bytes: number) => Promise<boolean>;
  /** Stops the family's download; what was fetched is kept for a retry. */
  cancelFontDownload: (id: string) => void;
  /** Clears a failed download. A running one is left alone. */
  dismissFontDownload: (id: string) => void;
}
