import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Session, connect, seedBook } from "./helpers";

const hook = vi.hoisted(() => ({ failSave: false }));
vi.mock("../project", async (orig) => {
  const real = await orig<typeof import("../project")>();
  return {
    ...real,
    saveManifest: (...a: Parameters<typeof real.saveManifest>) => {
      if (hook.failSave) throw new Error("disk full");
      return real.saveManifest(...a);
    },
  };
});

let s: Session;
afterEach(async () => {
  hook.failSave = false;
  await s.close();
});

const manifest = () => JSON.parse(readFileSync(join(s.root, "book/cadabra.json"), "utf8"));
const fail = async (args: Record<string, unknown>) => {
  const r = await s.call("cadabra_matter_add", { path: "book", ...args });
  expect(r.isError).toBe(true);
  return r.data.error.code as string;
};

describe("cadabra_matter_add", () => {
  it("adds an index page at the end of the back matter and turns the index on", async () => {
    s = await connect();
    await seedBook(s);
    const r = await s.ok("cadabra_matter_add", { path: "book", kind: "index" });
    expect(r).toMatchObject({ id: "bm-1", kind: "index" });
    const m = manifest();
    expect(m.backMatter.at(-1)).toMatchObject({ id: "bm-1", kind: "index" });
    expect(m.index.enabled).toBe(true);
    expect(existsSync(join(s.root, "book", r.file))).toBe(true);
  });

  it("takes a title, and refuses a second index or glossary page", async () => {
    s = await connect();
    await seedBook(s);
    await s.ok("cadabra_matter_add", { path: "book", kind: "glossary", title: "Words" });
    expect(manifest().backMatter[0].titles).toMatchObject({ "en-GB": "Words" });
    expect(await fail({ kind: "glossary" })).toBe("matter_page_exists");
    expect(manifest().backMatter).toHaveLength(1);
  });

  it("refuses an unlisted file in the way", async () => {
    s = await connect();
    await seedBook(s);
    const r = await s.ok("cadabra_matter_add", { path: "book", kind: "index" });
    const m = manifest();
    m.backMatter = [];
    writeFileSync(join(s.root, "book/cadabra.json"), JSON.stringify(m));
    expect(await fail({ kind: "index" })).toBe("io_error");
    expect(existsSync(join(s.root, "book", r.file))).toBe(true);
  });

  it("takes the new file back when the manifest cannot be saved", async () => {
    s = await connect();
    await seedBook(s);
    hook.failSave = true;
    await fail({ kind: "index" });
    const dir = join(s.root, "book/back-matter");
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });
});
