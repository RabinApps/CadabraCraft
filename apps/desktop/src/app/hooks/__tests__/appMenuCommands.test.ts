import { createManifest, addChapter, type Manifest } from "@cadabracraft/format";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  pickFolder: vi.fn(),
  openUrl: vi.fn(),
  quitApp: vi.fn(),
}));
vi.mock("../../../lib/bridge", () => ({
  bridge: { pickFolder: m.pickFolder, openUrl: m.openUrl },
}));
vi.mock("../../shell/native/quit", () => ({ quitApp: m.quitApp }));

import { useAnalysis } from "../../../state/app/analysis";
import { useLicenses } from "../../../state/app/licenses";
import { useReadAloudRequest } from "../../../state/app/readAloudRequest";
import { SPONSOR_URL } from "../../../state/app/sponsor";
import { useUpdates } from "../../../state/app/updates";
import { useWritingDialog } from "../../../state/app/writingDialog";
import { useProject } from "../../../state/project/index";
import {
  appCommands,
  bookCommands,
  guarded,
  writingCommands,
  type CommandEnv,
} from "../appMenuCommands";

const tick = () => new Promise((r) => setTimeout(r, 0));
const book = (): Manifest => {
  const base = createManifest({ title: "B", author: "A", identifier: "urn:x" });
  return addChapter(addChapter(base, "One").manifest, "Two").manifest;
};

function makeEnv(patch: Partial<CommandEnv> = {}) {
  const actions = Object.fromEntries(
    [
      "closeProject",
      "openProject",
      "flush",
      "undo",
      "redo",
      "add",
      "addBlank",
      "addMatter",
      "selectChapter",
    ].map((n) => [n, vi.fn(async () => {})]),
  );
  const h = {
    view: "book" as const,
    setView: vi.fn(),
    mode: "write" as const,
    setMode: vi.fn(),
    openExport: vi.fn(),
    openDetails: vi.fn(),
    openWelcome: vi.fn(),
    fail: vi.fn(),
  };
  const env = {
    h,
    actions,
    manifest: book(),
    history: { undo: [1], redo: [] },
    order: [{ id: "a" }, { id: "b" }, { id: "c" }],
    index: 1,
    recentCount: 2,
    clearRecents: vi.fn(),
    layout: { focus: false, details: true, references: false },
    setLayout: vi.fn(),
    typewriter: false,
    setTypewriter: vi.fn(),
    showQuickNav: vi.fn(),
    setCreating: vi.fn(),
    setImporting: vi.fn(),
    setImportingInto: vi.fn(),
    setLibraryOpen: vi.fn(),
    ...patch,
  } as unknown as CommandEnv;
  return { env, h, actions: actions as Record<string, ReturnType<typeof vi.fn>> };
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset().mockResolvedValue(undefined);
  useProject.setState({ notice: "" });
});

describe("guarded", () => {
  it("sends a failure to the error banner", async () => {
    const { env, h } = makeEnv();
    guarded(env)(async () => Promise.reject(new Error("no")))();
    await tick();
    expect(h.fail).toHaveBeenCalledWith("no");
  });
});

describe("appCommands", () => {
  it("quits through the guard and opens the palette and settings", async () => {
    const { env, h } = makeEnv();
    const c = appCommands(env);
    c["app.quit"]!.run();
    expect(m.quitApp).toHaveBeenCalled();
    expect(c["app.quit"]!.global).toBe(true);
    c["view.palette"]!.run();
    expect(env.showQuickNav).toHaveBeenCalledWith("palette");
    c["app.settings"]!.run();
    expect(h.setView).toHaveBeenCalledWith("settings");
    expect(c["app.settings"]!.enabled).toBe(true);
    for (const view of ["settings", "fonts"] as const)
      expect(
        appCommands(makeEnv({ h: { ...h, view } as never }).env)["app.settings"]!.enabled,
      ).toBe(false);
  });
  it("leaves the book before each start-screen dialog", async () => {
    const { env, h, actions } = makeEnv();
    const c = appCommands(env);
    c["file.new"]!.run();
    c["file.import"]!.run();
    c["file.library"]!.run();
    await tick();
    expect(actions.closeProject).toHaveBeenCalledTimes(3);
    expect(h.setView).toHaveBeenCalledWith("book");
    expect(env.setCreating).toHaveBeenCalledWith(true);
    expect(env.setImporting).toHaveBeenCalledWith(true);
    expect(env.setLibraryOpen).toHaveBeenCalledWith(true);
  });
  it("opens the folder that was picked, and nothing when none was", async () => {
    const { env, actions } = makeEnv();
    const open = appCommands(env)["file.open"]!;
    m.pickFolder.mockResolvedValueOnce(null);
    open.run();
    await tick();
    expect(actions.openProject).not.toHaveBeenCalled();
    m.pickFolder.mockResolvedValueOnce("/books/b");
    open.run();
    await tick();
    expect(actions.closeProject).toHaveBeenCalledTimes(1);
    expect(actions.openProject).toHaveBeenCalledWith("/books/b");
  });
  it("opens a recent project, reports a failure and ignores an empty folder", async () => {
    const { env, h, actions } = makeEnv();
    const recent = appCommands(env)["file.openRecent"]!;
    recent.run();
    await tick();
    expect(actions.openProject).not.toHaveBeenCalled();
    recent.run("/books/r");
    await tick();
    expect(actions.openProject).toHaveBeenCalledWith("/books/r");
    actions.openProject!.mockRejectedValueOnce(new Error("gone"));
    recent.run("/books/r");
    await tick();
    expect(h.fail).toHaveBeenCalledWith("gone");
  });
  it("clears recents only when there are some, and opens Welcome, Sponsor and Licenses", () => {
    const { env, h } = makeEnv();
    const c = appCommands(env);
    expect(c["file.clearRecents"]!.enabled).toBe(true);
    c["file.clearRecents"]!.run();
    expect(env.clearRecents).toHaveBeenCalled();
    expect(appCommands(makeEnv({ recentCount: 0 }).env)["file.clearRecents"]!.enabled).toBe(false);
    c["help.welcome"]!.run();
    expect(h.openWelcome).toHaveBeenCalled();
    c["help.sponsor"]!.run();
    expect(m.openUrl).toHaveBeenCalledWith(SPONSOR_URL);
    c["help.licenses"]!.run();
    expect(useLicenses.getState().open).toBe(true);
  });
  it.each([
    [{ kind: "current" }, "CadabraCraft is up to date.", null],
    [{ kind: "unsupported" }, "Your package manager updates this copy of CadabraCraft.", null],
    [{ kind: "error", message: "offline" }, "", "offline"],
    [{ kind: "idle" }, "", null],
  ])("Check for updates reports %j", async (status, notice, failure) => {
    const { env, h } = makeEnv();
    useUpdates.setState({ check: async () => useUpdates.setState({ status } as never) });
    appCommands(env)["help.updates"]!.run();
    await tick();
    expect(useProject.getState().notice).toBe(notice);
    if (failure) expect(h.fail).toHaveBeenCalledWith(failure);
    else expect(h.fail).not.toHaveBeenCalled();
  });
});

describe("bookCommands", () => {
  it("saves, shows dialogs and closes the book", async () => {
    const { env, h, actions } = makeEnv();
    const c = bookCommands(env);
    c["file.save"]!.run();
    c["file.bookDetails"]!.run();
    expect(h.openDetails).toHaveBeenCalled();
    c["file.analysis"]!.run();
    expect(useAnalysis.getState().open).toBe(true);
    c["file.writingHistory"]!.run();
    expect(useWritingDialog.getState().open).toBe(true);
    c["file.close"]!.run();
    await tick();
    expect(actions.flush).toHaveBeenCalledTimes(1);
    expect(actions.closeProject).toHaveBeenCalledTimes(1);
  });
  it("saves before print preview, import and every export", async () => {
    const { env, h, actions } = makeEnv();
    const c = bookCommands(env);
    c["file.printPreview"]!.run();
    c["file.importInto"]!.run();
    await tick();
    expect(h.setView).toHaveBeenCalledWith("print");
    expect(env.setImportingInto).toHaveBeenCalledWith(true);
    const formats = {
      "file.exportEpub": "epub",
      "file.exportPdf": "pdf",
      "file.exportMarkdown": "markdown",
      "file.exportDocx": "docx",
      "file.exportRtf": "rtf",
      "file.exportAudiobook": "audiobook",
    };
    for (const [id, format] of Object.entries(formats)) {
      c[id]!.run();
      await tick();
      expect(h.openExport).toHaveBeenLastCalledWith(format);
    }
    expect(actions.flush).toHaveBeenCalledTimes(8);
  });
  it("undoes, redoes and adds pages", async () => {
    const { env, actions } = makeEnv();
    const c = bookCommands(env);
    expect(c["edit.bookUndo"]!.enabled).toBe(true);
    expect(c["edit.bookRedo"]!.enabled).toBe(false);
    c["edit.bookUndo"]!.run();
    c["edit.bookRedo"]!.run();
    c["insert.chapter"]!.run();
    c["insert.blank"]!.run();
    c["insert.front.preface"]!.run();
    c["insert.back.colophon"]!.run();
    await tick();
    expect(actions.undo).toHaveBeenCalled();
    expect(actions.redo).toHaveBeenCalled();
    expect(actions.add).toHaveBeenCalledWith("Chapter 3");
    expect(actions.addBlank).toHaveBeenCalled();
    expect(actions.addMatter).toHaveBeenCalledWith("front", "preface");
    expect(actions.addMatter).toHaveBeenCalledWith("back", "colophon");
    expect(c["insert.back.index"]!.enabled).toBe(true);
  });
  it("switches modes, toggles the panels and opens the board and timeline", async () => {
    const { env, h } = makeEnv();
    const c = bookCommands(env);
    expect(c["view.write"]!.checked).toBe(true);
    expect(c["view.read"]!.checked).toBe(false);
    c["view.write"]!.run();
    expect(h.setMode).toHaveBeenCalledWith("write");
    c["view.read"]!.run();
    c["view.board"]!.run();
    c["view.timeline"]!.run();
    await tick();
    expect(h.setMode).toHaveBeenCalledWith("read");
    expect(h.setView).toHaveBeenCalledWith("board");
    expect(h.setView).toHaveBeenCalledWith("timeline");
    c["view.details"]!.run();
    c["view.references"]!.run();
    expect(env.setLayout).toHaveBeenCalledWith({ details: false });
    expect(env.setLayout).toHaveBeenCalledWith({ references: true });
    expect(c["view.details"]!.enabled).toBe(true);
    const reading = bookCommands(makeEnv({ h: { ...h, mode: "read" } as never }).env);
    expect(reading["view.details"]!.enabled).toBe(false);
    expect(reading["view.references"]!.enabled).toBe(false);
  });
  it("goes to the previous and next page when there is one", async () => {
    const { env, actions } = makeEnv();
    const c = bookCommands(env);
    c["go.previous"]!.run();
    c["go.next"]!.run();
    await tick();
    expect(actions.selectChapter).toHaveBeenCalledWith("a");
    expect(actions.selectChapter).toHaveBeenCalledWith("c");
    expect(c["go.previous"]!.enabled).toBe(true);
    expect(c["go.next"]!.enabled).toBe(true);
    const first = bookCommands(makeEnv({ index: 0 }).env);
    expect(first["go.previous"]!.enabled).toBe(false);
    const last = makeEnv({ index: 2 });
    const end = bookCommands(last.env);
    expect(end["go.next"]!.enabled).toBe(false);
    end["go.next"]!.run();
    await tick();
    expect(last.actions.selectChapter).not.toHaveBeenCalled();
    expect(bookCommands(makeEnv({ index: -1 }).env)["go.next"]!.enabled).toBe(false);
  });
});

describe("writingCommands", () => {
  it("jumps, toggles focus and typewriter and starts Read Aloud", () => {
    const { env } = makeEnv();
    const c = writingCommands(env);
    c["view.outline"]!.run();
    expect(env.showQuickNav).toHaveBeenCalledWith("outline");
    c["view.focus"]!.run();
    expect(env.setLayout).toHaveBeenCalledWith({ focus: true });
    c["view.typewriter"]!.run();
    expect(env.setTypewriter).toHaveBeenCalledWith(true);
    const before = useReadAloudRequest.getState().count;
    c["view.readAloud"]!.run();
    expect(useReadAloudRequest.getState().count).toBe(before + 1);
    expect(c["view.focus"]!.checked).toBe(false);
  });
});
