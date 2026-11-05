import { describe, expect, it } from "vitest";
import { isValidSceneId } from "@cadabracraft/shared";
import { newSceneId, sceneProgress, sceneRow, sceneRows, sceneWordsLabel } from "../scenes";

const scene = (attrs: Record<string, unknown> = {}, text = "one two three") => ({
  type: "scene",
  attrs: { id: "sc-1", ...attrs },
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});

const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("sceneRows", () => {
  it("finds the chapter's scenes in reading order with the words inside each", () => {
    const rows = sceneRows(
      doc(
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        scene({ title: "The quay", status: "draft", pov: "Mara", label: "Act I", target: 1000 }),
        scene({ id: "sc-2", title: "The wall" }, ""),
      ),
    );
    expect(rows.map((r) => [r.id, r.title, r.words])).toEqual([
      ["sc-1", "The quay", 3],
      ["sc-2", "The wall", 0],
    ]);
    expect(rows[0]).toMatchObject({ status: "draft", pov: "Mara", label: "Act I", target: 1000 });
  });

  it("keeps only the text entries of a cast and reads a cast that is not a list as empty", () => {
    const rows = sceneRows(
      doc(scene({ cast: ["mara", 7, null, "quay"] }), scene({ id: "sc-2", cast: "mara" })),
    );
    expect(rows.map((r) => r.cast)).toEqual([["mara", "quay"], []]);
  });

  it("has no rows for a page that holds no scenes", () => {
    expect(sceneRows(doc({ type: "paragraph" }))).toEqual([]);
    expect(sceneRows(null)).toEqual([]);
    expect(sceneRows("nope")).toEqual([]);
  });

  it("does not look for a scene inside a scene", () => {
    const nested = {
      type: "scene",
      attrs: { id: "outer" },
      content: [{ type: "scene", attrs: { id: "inner" }, content: [] }],
    };
    expect(sceneRows(doc(nested)).map((r) => r.id)).toEqual(["outer"]);
  });

  it("keeps a missing note empty rather than undefined", () => {
    const [row] = sceneRows(doc({ type: "scene", attrs: { id: 7 } }));
    expect(row).toEqual({
      id: "",
      title: "",
      status: "",
      pov: "",
      label: "",
      synopsis: "",
      target: null,
      date: "",
      cast: [],
      words: 0,
    });
  });
});

describe("sceneRow", () => {
  it("finds one scene by id", () => {
    expect(sceneRow(doc(scene({ title: "The quay" })), "sc-1")?.title).toBe("The quay");
  });

  it("finds nothing without an id or for an id the chapter does not have", () => {
    expect(sceneRow(doc(scene()), null)).toBeNull();
    expect(sceneRow(doc(scene()), "sc-9")).toBeNull();
  });
});

describe("sceneWordsLabel", () => {
  it("shows the words against the target when there is one", () => {
    const row = sceneRows(doc(scene({ target: 1000 })))[0]!;
    expect(sceneWordsLabel(row)).toBe("3 / 1,000");
  });

  it("shows the words alone when the scene has no target", () => {
    expect(sceneWordsLabel(sceneRows(doc(scene()))[0]!)).toBe("3");
  });
});

describe("sceneProgress", () => {
  it("is the share of the target written", () => {
    expect(sceneProgress(sceneRows(doc(scene({ target: 10 })))[0]!)).toBeCloseTo(0.3);
  });

  it("stops at the whole target", () => {
    expect(sceneProgress(sceneRows(doc(scene({ target: 1 })))[0]!)).toBe(1);
  });

  it("is null without a target", () => {
    expect(sceneProgress(sceneRows(doc(scene()))[0]!)).toBeNull();
    expect(sceneProgress(sceneRows(doc(scene({ target: 0 })))[0]!)).toBeNull();
  });
});

describe("newSceneId", () => {
  it("is a valid scene id", () => {
    expect(isValidSceneId(newSceneId())).toBe(true);
  });

  it("is new every time", () => {
    expect(newSceneId()).not.toBe(newSceneId());
  });
});
