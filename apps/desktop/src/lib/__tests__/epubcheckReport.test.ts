import { describe, expect, it } from "vitest";
import type { EpubcheckMessage, EpubcheckReport } from "../bridge";
import {
  asFailure,
  checksFromReport,
  failureText,
  messageText,
  summaryText,
} from "../export/epubcheckReport";

const msg = (over: Partial<EpubcheckMessage>): EpubcheckMessage => ({
  severity: "error",
  id: "RSC-005",
  message: "Bad",
  file: null,
  line: null,
  column: null,
  ...over,
});

const report = (
  messages: EpubcheckMessage[],
  over: Partial<EpubcheckReport> = {},
): EpubcheckReport => ({
  version: "5.4.0",
  counts: { fatal: 0, error: 0, warning: 0, usage: 0 },
  messages,
  omitted: 0,
  ...over,
});

describe("messageText", () => {
  it("joins the id, the text and the place", () => {
    expect(messageText(msg({ file: "OEBPS/a.xhtml", line: 3 }))).toBe(
      "RSC-005: Bad (OEBPS/a.xhtml:3)",
    );
    expect(messageText(msg({ file: "OEBPS/a.xhtml" }))).toBe("RSC-005: Bad (OEBPS/a.xhtml)");
    expect(messageText(msg({ id: "" }))).toBe("Bad");
  });
});

describe("checksFromReport", () => {
  it("is one ok row for a clean report", () => {
    expect(checksFromReport(report([]))).toEqual([
      { tone: "ok", text: "EPUBCheck found no problems." },
    ]);
  });

  it("maps severities to tones, worst first, and drops suppressed messages", () => {
    const rows = checksFromReport(
      report([
        msg({ severity: "usage", id: "U-1" }),
        msg({ severity: "warning", id: "W-1" }),
        msg({ severity: "suppressed", id: "S-1" }),
        msg({ severity: "fatal", id: "F-1" }),
        msg({ severity: "info", id: "I-1" }),
        msg({ severity: "error", id: "E-1" }),
      ]),
    );
    expect(rows.map((r) => [r.tone, r.text.slice(0, 3)])).toEqual([
      ["error", "F-1"],
      ["error", "E-1"],
      ["warn", "W-1"],
      ["info", "U-1"],
      ["info", "I-1"],
    ]);
  });

  it("says how many messages were left out", () => {
    expect(checksFromReport(report([msg({})], { omitted: 1 })).at(-1)?.text).toBe(
      "1 more message is not shown",
    );
    expect(checksFromReport(report([msg({})], { omitted: 5 })).at(-1)?.text).toBe(
      "5 more messages are not shown",
    );
  });
});

describe("summaryText", () => {
  it("counts errors (fatal included) and warnings", () => {
    expect(summaryText(report([], { counts: { fatal: 1, error: 1, warning: 1, usage: 4 } }))).toBe(
      "2 errors, 1 warning",
    );
    expect(summaryText(report([]))).toBe("No errors or warnings.");
  });
});

describe("failures", () => {
  it("reads the kind of a rejected bridge call, whatever else was thrown", () => {
    expect(asFailure({ kind: "timeout", seconds: 9 })).toEqual({ kind: "timeout", seconds: 9 });
    expect(asFailure(new Error("boom"))).toEqual({ kind: "other", message: "boom" });
    expect(asFailure("text")).toEqual({ kind: "other", message: "text" });
    expect(asFailure(null)).toEqual({ kind: "other", message: "null" });
  });

  it("has a sentence for every kind", () => {
    expect(failureText({ kind: "not_found", message: "x" })).toContain("was not found");
    expect(failureText({ kind: "timeout", seconds: 120 })).toContain("120 seconds");
    expect(failureText({ kind: "cancelled" })).toBe("The check was stopped.");
    expect(failureText({ kind: "no_epub" })).toContain("Export it first");
    expect(failureText({ kind: "failed", message: "m" })).toContain("m");
    expect(failureText({ kind: "other", message: "o" })).toContain("o");
  });
});
