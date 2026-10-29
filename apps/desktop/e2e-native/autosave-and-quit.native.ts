import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBook, eventually, filesContaining, typeAtEnd } from "./driver";
import { skip, useApp } from "./session";

// Real Rust writes: autosave without pressing Save, and the native close flushing unsaved typing.
describe.skipIf(skip)("native autosave and quit", () => {
  const app = useApp();

  it("autosaves typing to disk and flushes unsaved text when the window closes", async () => {
    const { driver } = app.session();
    const root = join(app.dir(), "book");
    await createBook(driver, root, "Autosave Book", "Tester");

    await typeAtEnd(driver, "Autosaved line");
    // No Save click: the 2 s autosave must write it.
    await eventually(() => filesContaining(root, "Autosaved line")[0]);

    await typeAtEnd(driver, " and a closing line");
    // Close the only window at once, before the autosave delay: useSaveOnClose must flush, then destroy the window.
    await driver.close().catch(() => {}); // the session may end together with the window
    const file = await eventually(() => filesContaining(root, "and a closing line")[0]);
    expect(readFileSync(join(root, file), "utf8")).toContain("Autosaved line");
    expect(JSON.parse(readFileSync(join(root, "cadabra.json"), "utf8"))).toMatchObject({
      editions: [{ title: "Autosave Book" }],
    });
  });
});
