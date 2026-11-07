import { describe, expect, it } from "vitest";
import { MAX_NOTE_CHARS } from "@cadabracraft/format";
import { linkTitle, noteTitle, parseDropped } from "../references/dropped";

const parse = (uriList: string, text = "") => parseDropped({ uriList, text });

describe("parseDropped", () => {
  it("makes a link of each http or https address in a uri list, skipping comments and other schemes", () => {
    const r = parse(
      "# a comment\r\nhttps://a.example.org/x\r\n\r\nfile:///Users/me/a.pdf\r\njavascript:alert(1)\r\nHTTP://B.example.org",
      "ignored when the list has links",
    );
    expect(r).toEqual({
      items: [
        { type: "link", url: "https://a.example.org/x" },
        { type: "link", url: "http://b.example.org/" },
      ],
      tooLong: false,
    });
  });
  it("keeps one link for an address dropped twice", () => {
    expect(parse("https://a.org/\nhttps://a.org/").items).toEqual([
      { type: "link", url: "https://a.org/" },
    ]);
  });
  it("takes plain text made only of addresses as links", () => {
    expect(parse("", "  https://a.org/one \n\n https://a.org/two ").items).toEqual([
      { type: "link", url: "https://a.org/one" },
      { type: "link", url: "https://a.org/two" },
    ]);
  });
  it("takes any other plain text as one note, trimmed", () => {
    expect(parse("", "\n  The wall is older\nthan the gate. https://a.org/ \n")).toEqual({
      items: [{ type: "note", text: "The wall is older\nthan the gate. https://a.org/" }],
      tooLong: false,
    });
  });
  it("never makes a link of a non-web address in plain text", () => {
    expect(parse("", "javascript:alert(1)").items).toEqual([
      { type: "note", text: "javascript:alert(1)" },
    ]);
  });
  it("returns nothing for empty data, and for a uri list with no web address and no text", () => {
    expect(parse("", "   \n ")).toEqual({ items: [], tooLong: false });
    expect(parse("file:///a.pdf")).toEqual({ items: [], tooLong: false });
  });
  it("refuses text longer than a note can be, and takes text at the limit", () => {
    expect(parse("", "x".repeat(MAX_NOTE_CHARS + 1))).toEqual({ items: [], tooLong: true });
    expect(parse("", "x".repeat(MAX_NOTE_CHARS)).items).toHaveLength(1);
  });
});

describe("titles", () => {
  it("titles a link by its host without www.", () => {
    expect(linkTitle("https://www.example.org/a")).toBe("example.org");
    expect(linkTitle("http://saltmarsh.example.org:8080/")).toBe("saltmarsh.example.org");
  });
  it("titles a note by its first non-empty line, shortened to 80 characters", () => {
    expect(noteTitle("\n\n  First line  \nSecond", "Note")).toBe("First line");
    expect(noteTitle("   ", "Note")).toBe("Note");
    expect(noteTitle("x".repeat(80), "Note")).toBe("x".repeat(80));
    expect(noteTitle("x".repeat(81), "Note")).toBe(`${"x".repeat(79)}…`);
  });
});
