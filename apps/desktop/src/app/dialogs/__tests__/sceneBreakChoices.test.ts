import { SCENE_BREAK_ORNAMENTS, SCENE_BREAK_ORNAMENT_IDS } from "@cadabracraft/shared";
import { DEFAULT_TEMPLATE_ID, getTemplate, listTemplates } from "@cadabracraft/templates";
import { describe, expect, it } from "vitest";
import {
  choiceFromValue,
  choiceValue,
  ornamentRows,
  templateMarkRows,
  TEMPLATE_DEFAULT_CHOICE,
  triggerText,
} from "../sceneBreakChoices";

describe("scene-break choices", () => {
  it("maps absent to the template default and back", () => {
    expect(choiceValue(null)).toBe(TEMPLATE_DEFAULT_CHOICE);
    expect(choiceFromValue(TEMPLATE_DEFAULT_CHOICE)).toBeNull();
    expect(choiceFromValue("fleuron")).toBe("fleuron");
    expect(choiceValue("fleuron")).toBe("fleuron");
  });

  it("lists the six ornaments with the glyphs the book stores", () => {
    const rows = ornamentRows();
    expect(rows.map((r) => r.id)).toEqual([...SCENE_BREAK_ORNAMENT_IDS]);
    for (const row of rows) {
      expect(row.glyph).toBe(SCENE_BREAK_ORNAMENTS[row.id].glyph);
      expect(row.name).not.toBe("");
    }
  });

  it("lists every template with its own mark", () => {
    const rows = templateMarkRows();
    expect(rows.map((r) => r.id)).toEqual(listTemplates().map((t) => t.id));
    for (const row of rows) expect(row.glyph).toBe(getTemplate(row.id).print.sceneBreak.glyph);
  });

  it("shows the template's mark for the default and the chosen mark otherwise", () => {
    const template = getTemplate(DEFAULT_TEMPLATE_ID);
    expect(triggerText(null, template.id)).toEqual({
      glyph: template.print.sceneBreak.glyph,
      name: "Template default",
    });
    expect(triggerText("dinkus", template.id)).toEqual({
      glyph: SCENE_BREAK_ORNAMENTS.dinkus.glyph,
      name: "Dinkus",
    });
    expect(triggerText("none", template.id)).toEqual({ glyph: "", name: "No mark" });
  });
});
