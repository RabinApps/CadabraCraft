import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexEntry } from "@cadabracraft/format";

const io = {
  read: null as null | { contents: string; hash: string },
  readFails: false,
  writeFails: false,
  written: [] as string[],
};
vi.mock("../../lib/bridge", () => ({
  bridge: {
    readFile: async () => {
      if (io.readFails) throw new Error("denied");
      return io.read;
    },
    writeFile: async (_r: string, _p: string, contents: string) => {
      if (io.writeFails) throw new Error("full");
      io.written.push(contents);
      return { hash: "h", conflict_copy: null };
    },
  },
}));

import { useProject } from "../project/index";
import { useCodex } from "../codex";

const file = (contents: string) => ({ contents, hash: "x" });
const entry: CodexEntry = {
  id: "ada",
  kind: "character",
  name: "Ada",
  aliases: [],
  summary: "",
  body: "",
  image: null,
  links: [],
};

beforeEach(() => {
  io.read = null;
  io.readFails = false;
  io.writeFails = false;
  io.written = [];
  useCodex.setState({ entries: [], loadedFor: null, error: "" });
  useProject.setState({ root: null });
});

describe("codex store", () => {
  it("reads no file as an empty codex, and does not read the same book twice", async () => {
    await useCodex.getState().load("/a");
    expect(useCodex.getState()).toMatchObject({ entries: [], loadedFor: "/a", error: "" });
    io.readFails = true;
    await useCodex.getState().load("/a");
    expect(useCodex.getState().error).toBe("");
  });

  it("reports an unreadable, invalid or misshapen file and leaves it alone", async () => {
    io.readFails = true;
    await useCodex.getState().load("/a");
    expect(useCodex.getState().error).toMatch(/could not be read/);
    io.readFails = false;
    io.read = file("nope");
    await useCodex.getState().load("/b");
    expect(useCodex.getState().error).toMatch(/not valid JSON/);
    io.read = file('{"entries":3}');
    await useCodex.getState().load("/c");
    expect(useCodex.getState().error).toMatch(/not the shape/);
    expect(io.written).toEqual([]);
  });

  it("opens a valid file", async () => {
    io.read = file(JSON.stringify({ entries: [entry] }));
    await useCodex.getState().load("/a");
    expect(useCodex.getState().error).toBe("");
    expect(useCodex.getState().entries).toEqual([entry]);
  });

  it("saves to the open project, or to the loaded one, and refuses with neither", async () => {
    expect(await useCodex.getState().save([])).toBe(false);
    useCodex.setState({ loadedFor: "/a" });
    expect(await useCodex.getState().save([entry])).toBe(true);
    useProject.setState({ root: "/p" });
    expect(await useCodex.getState().save([])).toBe(true);
    expect(JSON.parse(io.written[0]!)).toEqual({ entries: [entry] });
    expect(io.written[1]).toBe('{\n  "entries": []\n}\n');
  });

  it("puts the old list back when the write fails", async () => {
    useCodex.setState({ loadedFor: "/a" });
    io.writeFails = true;
    expect(await useCodex.getState().save([entry])).toBe(false);
    expect(useCodex.getState().entries).toEqual([]);
    expect(useCodex.getState().error).toMatch(/could not be saved/);
  });
});
