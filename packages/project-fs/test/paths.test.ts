import { afterEach, describe, expect, it } from "vitest";
import { fileBaseName, fileExtension, normalizeRelative } from "../src/paths";

// `lastComponent` reads process.platform at call time, so the Windows branch can be exercised on any OS.
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const onPlatform = (platform: NodeJS.Platform, fn: () => void) => {
  Object.defineProperty(process, "platform", { value: platform });
  try {
    fn();
  } finally {
    Object.defineProperty(process, "platform", originalPlatform);
  }
};

afterEach(() => {
  Object.defineProperty(process, "platform", originalPlatform);
});

describe("fileBaseName", () => {
  it("takes the last component of a Windows path, whichever separator it uses", () => {
    onPlatform("win32", () => {
      expect(fileBaseName("C:\\Users\\alex\\book.cadabra")).toBe("book.cadabra");
      expect(fileBaseName("C:/Users/alex/book.cadabra")).toBe("book.cadabra");
      expect(fileBaseName("D:\\books\\mixed/path\\cover.png")).toBe("cover.png");
      expect(fileBaseName("C:\\books\\trailing\\")).toBe("trailing");
    });
  });

  it("keeps backslash as a file-name character on POSIX, where it is legal", () => {
    onPlatform("darwin", () => {
      expect(fileBaseName("/Users/alex/book.cadabra")).toBe("book.cadabra");
      expect(fileBaseName("odd\\name.txt")).toBe("odd\\name.txt");
    });
    onPlatform("linux", () => {
      expect(fileBaseName("/home/alex/book.cadabra")).toBe("book.cadabra");
    });
  });
});

describe("fileExtension", () => {
  it("lower-cases the extension of the last component on every platform", () => {
    onPlatform("win32", () => {
      expect(fileExtension("C:\\Books\\Story.EPUB")).toBe("epub");
      expect(fileExtension("C:\\Books.v2\\cover.PNG")).toBe("png");
    });
    onPlatform("darwin", () => {
      expect(fileExtension("/Books/Story.EPUB")).toBe("epub");
    });
  });

  it("has no extension for dotfiles and for '..'", () => {
    onPlatform("win32", () => {
      expect(fileExtension("C:\\Books\\.hidden")).toBeNull();
      expect(fileExtension("C:\\Books\\..")).toBeNull();
    });
    expect(fileExtension(".env")).toBeNull();
  });
});

describe("normalizeRelative", () => {
  it("accepts forward-slash project paths and drops interior '.' and repeated '/'", () => {
    expect(normalizeRelative("chapters/one.json")).toBe("chapters/one.json");
    expect(normalizeRelative("assets//./img/pixel.png")).toBe("assets/img/pixel.png");
  });

  it("refuses backslashes on every platform, so a Windows-style path cannot escape the project", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      onPlatform(platform, () => {
        expect(() => normalizeRelative("chapters\\one.json")).toThrow(/unsafe project path/);
        expect(() => normalizeRelative("..\\secret.txt")).toThrow(/unsafe project path/);
      });
    }
  });

  it("refuses absolute, parent and empty paths", () => {
    expect(() => normalizeRelative("/etc/passwd")).toThrow(/unsafe project path/);
    expect(() => normalizeRelative("C:/Windows/system.ini")).toThrow(/unsafe project path/);
    expect(() => normalizeRelative("manuscript/001.json:stream")).toThrow(/unsafe project path/);
    expect(() => normalizeRelative("../x")).toThrow(/unsafe project path/);
    expect(() => normalizeRelative("")).toThrow(/unsafe project path/);
    expect(() => normalizeRelative("./")).toThrow(/unsafe project path/);
  });
});
