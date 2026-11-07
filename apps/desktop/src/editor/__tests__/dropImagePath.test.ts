import { describe, expect, it } from "vitest";
import { isImagePath } from "../drop/useEditorFileDrop";

describe("isImagePath", () => {
  it.each(["/a/b.png", "C:\\pics\\b.JPG", "/x/y.jpeg", "/x/y.gif", "/x/y.webp", "/x/y.SVG"])(
    "accepts %s",
    (p) => expect(isImagePath(p)).toBe(true),
  );
  it.each(["/a/b.pdf", "/a/png", "/a/.png", "/a/folder", "/a/b.png.txt", "/a/b."])(
    "refuses %s",
    (p) => expect(isImagePath(p)).toBe(false),
  );
});
