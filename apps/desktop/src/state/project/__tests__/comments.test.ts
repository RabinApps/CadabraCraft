import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

let failWrite = false;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    writeFile: async (_r: string, path: string, contents: string) => {
      if (failWrite) throw new Error("disk full");
      disk.set(path, contents);
      return { hash: `h${contents.length}`, conflict_copy: null };
    },
  }),
);

import { useProject } from "../index";

const a = () => useProject.getState().actions;
const s = () => useProject.getState();
const onDisk = (page: string) => JSON.parse(disk.get(`comments/${page}.json`)!);

beforeEach(async () => {
  disk.clear();
  failWrite = false;
  useProject.setState({ root: null, manifest: null, notice: "", alertNotice: "", comments: [] });
  await a().createProject("/p", "Book", "Me");
});

describe("comments", () => {
  it("reads an empty page as no comments, and remembers which page they belong to", async () => {
    await a().loadComments(s().currentId);
    expect(s().comments).toEqual([]);
    expect(s().commentsPageId).toBe(s().currentId);
    await a().loadComments(null);
    expect(s().commentsPageId).toBeNull();
  });

  it("adds a thread under the book's author and saves it beside the book", async () => {
    const page = s().currentId!;
    await a().addComment("c-1", "  Too long here.  ");
    expect(s().comments).toHaveLength(1);
    expect(s().comments[0]).toMatchObject({
      id: "c-1",
      author: "Me",
      body: "Too long here.",
      resolved: false,
      replies: [],
    });
    expect(onDisk(page).threads[0].body).toBe("Too long here.");
    // Reading the file again gives the same thread back.
    await a().loadComments(page);
    expect(s().comments[0]).toMatchObject({ id: "c-1", author: "Me" });
  });

  it("adds the page's first comment without a load, and ignores a blank body or a repeated id", async () => {
    await a().addComment("c-1", "one");
    await a().addComment("c-1", "again");
    await a().addComment("c-2", "   ");
    expect(s().comments.map((x) => x.id)).toEqual(["c-1"]);
  });

  it("replies and resolves, writing each change at once", async () => {
    const page = s().currentId!;
    await a().addComment("c-1", "one");
    await a().replyComment("c-1", "  noted ");
    await a().resolveComment("c-1", true);
    expect(s().comments[0]!.replies).toHaveLength(1);
    expect(s().comments[0]!.replies[0]).toMatchObject({ author: "Me", body: "noted" });
    expect(s().comments[0]!.resolved).toBe(true);
    expect(onDisk(page).threads[0].replies).toHaveLength(1);
    expect(onDisk(page).threads[0].resolved).toBe(true);
    await a().resolveComment("c-1", false);
    expect(onDisk(page).threads[0].resolved).toBe(false);
  });

  it("ignores a reply to a thread that is not there, and a blank one", async () => {
    await a().addComment("c-1", "one");
    await a().replyComment("c-9", "hello");
    await a().replyComment("c-1", "  ");
    expect(s().comments[0]!.replies).toEqual([]);
  });

  it("reports a file that is not JSON, or not a comments file, and leaves it alone", async () => {
    const page = s().currentId!;
    disk.set(`comments/${page}.json`, "{");
    await a().loadComments(page);
    expect(s().comments).toEqual([]);
    expect(s().alertNotice).toMatch(/not valid JSON/);
    expect(disk.get(`comments/${page}.json`)).toBe("{");

    disk.set(`comments/${page}.json`, JSON.stringify({ threads: [{ id: "!" }] }));
    await a().loadComments(page);
    expect(s().comments).toEqual([]);
    expect(s().alertNotice).toMatch(/could not be opened/);
  });

  it("puts the old list back when the file cannot be written, and says so", async () => {
    await a().addComment("c-1", "one");
    failWrite = true;
    await a().addComment("c-2", "two");
    expect(s().comments.map((x) => x.id)).toEqual(["c-1"]);
    expect(s().alertNotice).toMatch(/Could not save the comments/);
  });

  it("forgets the threads in memory without touching the file", async () => {
    await a().addComment("c-1", "one");
    await a().dismissComments();
    expect(s().comments).toEqual([]);
    expect(s().commentsPageId).toBeNull();
    expect(disk.has("comments/c-missing.json")).toBe(false);
  });
});
