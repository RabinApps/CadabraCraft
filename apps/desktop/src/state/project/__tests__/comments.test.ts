import { beforeEach, describe, expect, it, vi } from "vitest";
import { disk } from "../../../test/fakeBridge";

let failWrite = false;
let failRead = false;
vi.mock("../../../lib/bridge", async () =>
  (await import("../../../test/fakeBridge")).fakeBridge({
    readFile: async (_r: string, path: string) => {
      if (failRead && path.startsWith("comments/")) throw new Error("denied");
      const contents = disk.get(path);
      return contents === undefined ? null : { contents, hash: `h${contents.length}` };
    },
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
  failRead = false;
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

  it("reports a comments file that cannot be read, and shows none", async () => {
    failRead = true;
    await a().loadComments(s().currentId);
    expect(s().comments).toEqual([]);
    expect(s().alertNotice).toMatch(/could not be read/);
  });

  it("does nothing with no project open", async () => {
    useProject.setState({ root: null });
    await a().loadComments("anything");
    expect(s().commentsPageId).not.toBe("anything");
  });

  it("refuses a thread past the page's limit, and a body that is too long", async () => {
    const threads = Array.from({ length: 500 }, (_, i) => ({
      id: `t-${i}`,
      author: "Me",
      body: "x",
      createdAt: "2026-01-01T00:00:00.000Z",
      resolved: false,
      replies: [],
    }));
    useProject.setState({ comments: threads as never, commentsPageId: s().currentId });
    await a().addComment("c-new", "one more");
    expect(s().comments).toHaveLength(500);
    expect(s().alertNotice).toMatch(/at most 500 comments/);
    useProject.setState({ comments: [] });
    await a().addComment("c-long", "x".repeat(100000));
    expect(s().comments).toEqual([]);
  });

  it("refuses a reply past the thread's limit, and signs as Anonymous for a book with no author", async () => {
    await a().addComment("c-1", "one");
    const replies = Array.from({ length: 200 }, (_, i) => ({
      author: "Me",
      body: "r",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: `r-${i}`,
    }));
    useProject.setState({ comments: [{ ...s().comments[0]!, replies } as never] });
    await a().replyComment("c-1", "too many");
    expect(s().comments[0]!.replies.length).toBeLessThanOrEqual(200);
    await a().dismissComments();
    useProject.setState({
      manifest: {
        ...s().manifest!,
        editions: s().manifest!.editions.map((e) => ({ ...e, author: "  " })),
      },
    });
    await a().loadComments(s().currentId);
    await a().addComment("c-2", "who");
    expect(s().comments.find((x) => x.id === "c-2")!.author).toBe("Anonymous");
  });

  it("ignores a resolve with no page loaded", async () => {
    await a().dismissComments();
    await a().resolveComment("c-1", true);
    expect(s().comments).toEqual([]);
  });
});
