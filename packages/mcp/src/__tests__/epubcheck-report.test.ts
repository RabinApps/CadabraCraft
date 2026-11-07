import { afterEach, describe, expect, it, vi } from "vitest";
import { type Session, connect, seedBook } from "./helpers";

// A real failing run needs a deliberately broken EPUB; the summary line only depends on the result object.
vi.mock("../external", async (orig) => ({
  ...(await orig<typeof import("../external")>()),
  runEpubcheck: async () => ({
    ran: true,
    passed: false,
    messages: ["ERROR(RSC-005): chapter-1.xhtml: bad markup", "WARNING(OPF-1): only this one"],
    summary: "Check finished with warnings or errors",
  }),
}));

let s: Session;
afterEach(() => s.close());

describe("export_epub when EPUBCheck reports messages", () => {
  it("says how many messages the check reported instead of claiming a pass", async () => {
    s = await connect({ epubcheckJar: "/stub/epubcheck.jar" });
    const { path } = await seedBook(s);
    const r = await s.call("cadabra_export_epub", { path });
    expect(r.data.epubcheck).toMatchObject({ ran: true, passed: false });
    expect(r.texts.join(" ")).toContain("EPUBCheck reported 2 message(s)");
  });
});
