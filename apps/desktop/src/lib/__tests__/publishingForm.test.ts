import { describe, expect, it } from "vitest";
import {
  publishingFromForm,
  publishingProblem,
  publishingToForm,
  subjectLines,
  type PublishingForm,
} from "../export/publishingForm";

const blank: PublishingForm = publishingToForm(undefined);

describe("publishing form", () => {
  it("round-trips every field and shows subjects one per line", () => {
    const p = {
      publisher: "Quay Press",
      description: "One.\nTwo.",
      subjects: ["a", "b"],
      series: "Harbour Lights",
      seriesNumber: "1.5",
      rights: "© 2026",
      published: "2026-11-03",
    };
    const form = publishingToForm(p);
    expect(form.subjects).toBe("a\nb");
    expect(publishingFromForm(form)).toEqual(p);
    expect(publishingFromForm(blank)).toEqual({});
  });
  it("trims, normalises line breaks and drops empty subjects and repeats", () => {
    expect(subjectLines(" a \r\n\r\nb\na\n")).toEqual(["a", "b"]);
    expect(publishingFromForm({ ...blank, description: " x\r\ny " }).description).toBe("x\ny");
  });
  it("leaves out the number of a series when none is given", () => {
    expect(publishingFromForm({ ...blank, series: " Saga " })).toEqual({ series: "Saga" });
  });

  it("leaves out a series number that has no series", () => {
    expect(publishingFromForm({ ...blank, seriesNumber: "3" })).toEqual({});
  });
  it("finds nothing wrong with a blank or a valid form", () => {
    expect(publishingProblem(blank)).toBeNull();
    expect(
      publishingProblem({ ...blank, series: "S", seriesNumber: "2.5", published: "2024-02-29" }),
    ).toBeNull();
  });
  it("names the first problem and its field", () => {
    expect(publishingProblem({ ...blank, publisher: "a\nb" })).toEqual({
      field: "publisher",
      code: "multi-line",
    });
    expect(publishingProblem({ ...blank, rights: "x".repeat(501) })).toEqual({
      field: "rights",
      code: "too-long",
      max: 500,
    });
    expect(publishingProblem({ ...blank, description: "x".repeat(4001) })).toMatchObject({
      field: "description",
      code: "too-long",
    });
    const many = Array.from({ length: 21 }, (_, i) => `s${i}`).join("\n");
    expect(publishingProblem({ ...blank, subjects: many })).toMatchObject({ code: "too-many" });
    expect(publishingProblem({ ...blank, subjects: "x".repeat(101) })).toMatchObject({
      field: "subjects",
      code: "too-long",
      max: 100,
    });
    expect(publishingProblem({ ...blank, seriesNumber: "1" })).toEqual({
      field: "seriesNumber",
      code: "needs-series",
    });
    expect(publishingProblem({ ...blank, series: "S", seriesNumber: "one" })).toEqual({
      field: "seriesNumber",
      code: "bad-number",
    });
    for (const published of ["2026-02-29", "soon", "2026-1-1"])
      expect(publishingProblem({ ...blank, published })).toEqual({
        field: "published",
        code: "bad-date",
      });
  });
});
