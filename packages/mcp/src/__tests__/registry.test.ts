import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect } from "./helpers";

let s: Session;
afterEach(() => s.close());

const EXPECTED = [
  "cadabra_project_create",
  "cadabra_project_info",
  "cadabra_project_validate",
  "cadabra_chapter_add",
  "cadabra_chapter_rename",
  "cadabra_chapter_move",
  "cadabra_chapter_remove",
  "cadabra_chapter_read",
  "cadabra_chapter_write_markdown",
  "cadabra_chapter_write_json",
  "cadabra_import_file",
  "cadabra_import_outline",
  "cadabra_reference_list",
  "cadabra_reference_add",
  "cadabra_reference_update",
  "cadabra_toc_get",
  "cadabra_toc_update",
  "cadabra_index_list",
  "cadabra_index_add",
  "cadabra_index_remove",
  "cadabra_index_settings",
  "cadabra_glossary_list",
  "cadabra_glossary_add",
  "cadabra_glossary_update",
  "cadabra_glossary_remove",
  "cadabra_glossary_settings",
  "cadabra_export_epub",
  "cadabra_export_pdf",
  "cadabra_export_markdown",
  "cadabra_export_outline",
  "cadabra_export_docx",
  "cadabra_export_rtf",
  "cadabra_inspect_pdf",
  "cadabra_inspect_epub",
  "cadabra_list_templates",
  "cadabra_set_template",
  "cadabra_edition_add",
];
const READ_ONLY = [
  "project_info",
  "project_validate",
  "chapter_read",
  "inspect_pdf",
  "inspect_epub",
  "list_templates",
  "reference_list",
  "toc_get",
  "index_list",
  "glossary_list",
].map((n) => `cadabra_${n}`);

describe("tool registry", () => {
  it("exposes exactly the documented tools, each with a description, schema and full annotations", async () => {
    s = await connect();
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED].sort());
    for (const t of tools) {
      expect(t.description, t.name).toBeTruthy();
      expect(t.inputSchema.type).toBe("object");
      const a = t.annotations!;
      expect(typeof a.readOnlyHint, t.name).toBe("boolean");
      expect(a.readOnlyHint ? undefined : typeof a.destructiveHint, t.name).toBe(
        a.readOnlyHint ? undefined : "boolean",
      );
      expect(typeof a.idempotentHint, t.name).toBe("boolean");
      expect(a.openWorldHint, t.name).toBe(false);
      expect(a.readOnlyHint, t.name).toBe(READ_ONLY.includes(t.name));
    }
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations!]));
    expect(by["cadabra_chapter_remove"]!.destructiveHint).toBe(true);
    expect(by["cadabra_chapter_write_json"]!.destructiveHint).toBe(true);
    expect(by["cadabra_chapter_add"]!.destructiveHint).toBe(false);
    expect(by["cadabra_set_template"]!.idempotentHint).toBe(true);
    expect(by["cadabra_edition_add"]).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(by["cadabra_chapter_rename"]!.idempotentHint).toBe(true);
    expect(by["cadabra_chapter_move"]!.idempotentHint).toBe(false);
    expect(by["cadabra_toc_update"]).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(by["cadabra_toc_get"]!.idempotentHint).toBe(true);
    expect(by["cadabra_export_epub"]!.destructiveHint).toBe(false);
    expect(by["cadabra_index_remove"]!.destructiveHint).toBe(true);
    expect(by["cadabra_glossary_remove"]!.destructiveHint).toBe(true);
    expect(by["cadabra_index_add"]!.destructiveHint).toBe(false);
  });

  it("serves the two docs as resources", async () => {
    s = await connect();
    const { resources } = await s.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "cadabra://docs/file-format",
      "cadabra://docs/import",
    ]);
    const ff = await s.client.readResource({ uri: "cadabra://docs/file-format" });
    expect(String((ff.contents[0] as { text: string }).text)).toContain("formatVersion");
    const imp = await s.client.readResource({ uri: "cadabra://docs/import" });
    expect(String((imp.contents[0] as { text: string }).text)).toContain("importMarkdown");
  });

  it("refuses to start without a usable root, and returns tool errors (not crashes) for bad calls", async () => {
    const { createServer } = await import("../server");
    expect(() => createServer({ root: "" })).toThrow(/CADABRA_MCP_ROOT/);
    expect(() => createServer({ root: "/definitely/not/here" })).toThrow(/workspace/);
    s = await connect();
    const r = await s.call("cadabra_project_info", { path: "nope" });
    expect(r.isError).toBe(true);
    expect(r.data.error.code).toBe("not_a_project");
    const bad = await s.call("cadabra_project_info", {});
    expect(bad.isError).toBe(true);
    const unknown = await s.call("cadabra_does_not_exist", {});
    expect(unknown.isError).toBe(true);
  });

  it("returns a short summary plus JSON text for every success", async () => {
    s = await connect();
    const r = await s.call("cadabra_list_templates");
    expect(r.isError).toBe(false);
    expect(r.texts).toHaveLength(2);
    expect(r.texts[0]!.length).toBeLessThan(200);
    expect(JSON.parse(r.texts[1]!)).toEqual(r.data);
  });
});
