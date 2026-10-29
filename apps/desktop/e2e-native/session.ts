import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { nativeSupport, startSession, type Session } from "./driver";

/** Why the suite cannot run here (null when it can). Printed once per spec file. */
export const skip = nativeSupport();
if (skip) console.warn(`[native e2e] skipped: ${skip}`);

/** A fresh app process and a temp folder per spec file; both are cleaned up afterwards. */
export function useApp(): { session: () => Session; dir: () => string } {
  let session: Session | undefined;
  let dir = "";
  beforeAll(async () => {
    if (skip) return;
    dir = mkdtempSync(join(tmpdir(), "cadabracraft-native-"));
    session = await startSession();
  });
  afterAll(async () => {
    await session?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  return { session: () => session as Session, dir: () => dir };
}
