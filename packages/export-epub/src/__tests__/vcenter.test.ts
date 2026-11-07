import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { getTemplate, listTemplates } from "@cadabracraft/templates";
import { buildEpub } from "../index";
import { matterBook } from "./matterBook";

const meta = {
  title: "The Long Quay",
  author: "A. Writer",
  language: "en",
  identifier: "urn:uuid:00000000-0000-4000-8000-000000000000",
  modified: new Date("2026-01-01T00:00:00Z"),
};
type Files = ReturnType<typeof unzipSync>;
const text = (f: Files, p: string) => strFromU8(f[p]!);
const classOf = (f: Files, id: string) =>
  /<body[^>]*class="([^"]*)"/.exec(text(f, `OEBPS/${id}.xhtml`))![1];
const kinds = ["title-page", "dedication", "epigraph"] as const;

describe("vertical centring class", () => {
  it("marks the kinds the template centres, and no chapter or other matter", () => {
    const f = unzipSync(buildEpub(meta, matterBook(), { centerKinds: kinds }));
    expect(classOf(f, "fm-1")).toBe("title-page vcenter");
    expect(classOf(f, "fm-3")).toBe("dedication vcenter");
    expect(classOf(f, "fm-4")).toBe("epigraph vcenter");
    expect(classOf(f, "fm-2")).toBe("copyright");
    expect(classOf(f, "fm-5")).toBe("foreword");
    expect(classOf(f, "ch-1")).toBe("chapter");
    expect(classOf(f, "bm-2")).toBe("about-the-author");
  });

  it("marks nothing when no kinds are given", () => {
    expect(classOf(unzipSync(buildEpub(meta, matterBook())), "fm-1")).toBe("title-page");
  });

  it("lets the page's own choice win either way, and ignores a chapter's", () => {
    const pages = matterBook().map((c) =>
      c.id === "fm-1"
        ? { ...c, verticalCenter: false }
        : c.id === "fm-5" || c.id === "ch-1"
          ? { ...c, verticalCenter: true }
          : c,
    );
    const f = unzipSync(buildEpub(meta, pages, { centerKinds: kinds }));
    expect(classOf(f, "fm-1")).toBe("title-page");
    expect(classOf(f, "fm-5")).toBe("foreword vcenter");
    expect(classOf(f, "ch-1")).toBe("chapter");
  });

  it("takes the template's kinds like the app does", () => {
    const centerKinds = getTemplate("novel").print.matter.verticalCenter;
    const f = unzipSync(buildEpub(meta, matterBook(), { centerKinds }));
    expect(classOf(f, "fm-1")).toBe("title-page vcenter");
  });
});

describe("vertical centring stylesheet", () => {
  const sheets = [
    ["the default", () => text(unzipSync(buildEpub(meta, matterBook())), "OEBPS/style.css")],
    ...listTemplates().map((t) => [t.id, () => t.epub.css] as const),
  ] as const;
  it.each(sheets)("%s has a margin fallback and a flex rule inside @supports", (_n, css) => {
    const s = css();
    expect(s).toContain("body.vcenter{margin-top:25%}");
    expect(s).toMatch(/@supports \(display:flex\)\{body\.vcenter[^}]*min-height:90vh[^}]*\}\}/);
    // The title page's own top margin is no longer baked in: only a centred page has one.
    expect(s).not.toContain("body.title-page h1{margin:30%");
  });
});
