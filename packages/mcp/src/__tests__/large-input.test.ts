import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type Session, connect, snapshot } from "./helpers";

/** enwik8 (100 MB of Wikipedia XML) is fetched by scripts/fetch-enwik8.sh into tools/enwik8/; see packages/import-docx/test/large-input.test.ts. */
const ENWIK8 = fileURLToPath(new URL("../../../../tools/enwik8/enwik8", import.meta.url));
const have = existsSync(ENWIK8);
if (!have && process.env.REQUIRE_ENWIK8 === "1") throw new Error("tools/enwik8/enwik8 is missing; run scripts/fetch-enwik8.sh");
const real = have ? it : it.skip;

let s: Session;
afterEach(async () => {
  await s?.close();
  s = undefined as unknown as Session;
});

describe("import_file with a 100 MB real-world file", () => {
  for (const ext of ["html", "md", "txt"]) {
    real(`a 100 MB .${ext} is refused with a tool error, nothing is created and the server stays usable`, async () => {
      s = await connect();
      copyFileSync(ENWIK8, join(s.root, `enwik8.${ext}`));
      const before = snapshot(s.root);
      const r = await s.call("cadabra_import_file", { source: `enwik8.${ext}`, destination: "out" });
      expect(r.isError).toBe(true);
      expect(["import_failed", "source_invalid", "too_large"]).toContain(r.data.error.code);
      expect(existsSync(join(s.root, "out"))).toBe(false);
      expect(snapshot(s.root)).toEqual(before);
      const again = await s.call("cadabra_list_templates", {});
      expect(again.isError).toBeFalsy();
    }, 180_000);
  }
});
