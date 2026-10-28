// Branches that only a failure between two steps can reach (a file that vanishes after it was checked, an importer or
// poppler that throws something unexpected). The collaborator is wrapped so one call can be made to misbehave.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  manifestMissing: false,
  exportPlan: null as null | (() => never),
  markdown: null as null | (() => unknown),
  poppler: null as null | (() => never),
}));

vi.mock("@cadabracraft/project-fs", async (orig) => {
  const real = await orig<typeof import("@cadabracraft/project-fs")>();
  return {
    ...real,
    readProjectFile: (root: string, rel: string) =>
      fake.manifestMissing && rel === "cadabra.json" ? null : real.readProjectFile(root, rel),
  };
});
vi.mock("@cadabracraft/format", async (orig) => {
  const real = await orig<typeof import("@cadabracraft/format")>();
  return {
    ...real,
    exportPlan: (...a: Parameters<typeof real.exportPlan>) =>
      fake.exportPlan ? fake.exportPlan() : real.exportPlan(...a),
  };
});
vi.mock("@cadabracraft/import-docx", async (orig) => {
  const real = await orig<typeof import("@cadabracraft/import-docx")>();
  return {
    ...real,
    importMarkdown: (t: string) => (fake.markdown ? fake.markdown() : real.importMarkdown(t)),
  };
});
vi.mock("../external", async (orig) => {
  const real = await orig<typeof import("../external")>();
  return {
    ...real,
    poppler: (...a: Parameters<typeof real.poppler>) =>
      fake.poppler ? fake.poppler() : real.poppler(...a),
  };
});

import { ProjectFsError } from "@cadabracraft/project-fs";
import { ToolError } from "../errors";
import { type Session, connect } from "./helpers";

let s: Session;
afterEach(async () => {
  fake.manifestMissing = false;
  fake.exportPlan = fake.markdown = fake.poppler = null;
  await s.close();
});

const book = async () => {
  s = await connect();
  await s.ok("cadabra_project_create", { path: "p", title: "Book", author: "Me" });
  const a = await s.ok("cadabra_chapter_add", { path: "p", title: "One" });
  return a.chapter.id as string;
};
const code = async (name: string, args: Record<string, unknown>) => {
  const r = await s.call(name, args);
  expect(r.isError).toBe(true);
  return r.data.error.code as string;
};

describe("a manifest that disappears after the project was recognised", () => {
  it("is not_a_project when loading", async () => {
    await book();
    fake.manifestMissing = true;
    expect(await code("cadabra_project_info", { path: "p" })).toBe("not_a_project");
  });
  it("is a manifest_invalid issue when validating", async () => {
    await book();
    fake.manifestMissing = true;
    const r = await s.ok("cadabra_project_validate", { path: "p" });
    expect(r.issues[0]).toMatchObject({ severity: "error", code: "manifest_invalid" });
  });
});

describe("unexpected failures are internal errors, not translated into something else", () => {
  it("export plan", async () => {
    await book();
    fake.exportPlan = () => {
      throw new TypeError("boom");
    };
    expect(await code("cadabra_export_markdown", { path: "p" })).toBe("internal_error");
  });
  it("import of a Markdown file", async () => {
    await book();
    writeFileSync(join(s.root, "b.md"), "# Hi\n");
    fake.markdown = () => {
      throw new TypeError("boom");
    };
    expect(await code("cadabra_import_file", { source: "b.md", destination: "out" })).toBe(
      "internal_error",
    );
  });
});

describe("chapter_write_markdown", () => {
  it("refuses a converted document that the editor schema rejects", async () => {
    const id = await book();
    fake.markdown = () => ({
      chapters: [{ title: "x", doc: { type: "doc", content: [{ type: "bogus" }] } }],
      assets: [],
      warnings: [],
    });
    expect(
      await code("cadabra_chapter_write_markdown", { path: "p", chapterId: id, markdown: "# x" }),
    ).toBe("invalid_chapter_doc");
  });
});

describe("inspect_pdf when poppler fails in ways of its own", () => {
  const pdf = () => {
    mkdirSync(join(s.root, "p/exports/en"), { recursive: true });
    writeFileSync(join(s.root, "p/exports/en/book.pdf"), "%PDF-1.7");
  };
  it("keeps the code of a tool error", async () => {
    await book();
    pdf();
    fake.poppler = () => {
      throw new ToolError("timeout", "slow");
    };
    expect(await code("cadabra_inspect_pdf", { path: "p" })).toBe("timeout");
  });
  it("keeps the code of a file-system error", async () => {
    await book();
    pdf();
    fake.poppler = () => {
      throw new ProjectFsError("permission_denied", "no");
    };
    expect(await code("cadabra_inspect_pdf", { path: "p" })).toBe("io_error");
  });
});
