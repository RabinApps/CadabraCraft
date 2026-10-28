import { expect, type Page } from "@playwright/test";

// Failure and timing injection for the coverage specs. It wraps the fake Tauri `invoke` (fakeTauri.ts), so it must be
// installed after `fakeTauri(page)`. Behaviours are set from the test with the helpers below; everything else falls
// through to the fake.

interface Cov {
  /** Commands that throw this error (`times` more calls, then they work again). */
  fail: Record<string, { error: unknown; times: number }>;
  /** Commands that wait for their gate before running. */
  gate: Record<string, Promise<void>>;
  open: Record<string, () => void>;
  /** Commands answered with this value instead of the fake's. */
  ret: Record<string, unknown>;
  /** Commands answered by calling this function with the arguments. */
  fn: Record<string, (a: unknown, o: unknown) => unknown>;
  /** Every command invoked, in order. */
  log: string[];
}
type CovWindow = Window & { __cov: Cov };

export async function covBackend(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as CovWindow;
    w.__cov = { fail: {}, gate: {}, open: {}, ret: {}, fn: {}, log: [] };
    const base = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd, a, o) => {
      const c = w.__cov;
      c.log.push(cmd);
      await c.gate[cmd];
      const f = c.fail[cmd];
      if (f && f.times > 0) {
        f.times--;
        throw f.error;
      }
      if (cmd in c.ret) return c.ret[cmd];
      if (cmd in c.fn) return c.fn[cmd]!(a, o);
      return base(cmd, a, o);
    };
  });
}

/** Makes `cmd` throw `error` for the next `times` calls (default: every call from now on). */
export const failOn = (page: Page, cmd: string, error: unknown, times = 1e9) =>
  page.evaluate(
    ([c, e, n]) => {
      (window as unknown as CovWindow).__cov.fail[c as string] = { error: e, times: n as number };
    },
    [cmd, error, times],
  );

export const stopFailing = (page: Page, cmd: string) =>
  page.evaluate((c) => {
    delete (window as unknown as CovWindow).__cov.fail[c];
  }, cmd);

/** Makes `cmd` wait until `release(page, cmd)`. */
export const hold = (page: Page, cmd: string) =>
  page.evaluate((c) => {
    const cov = (window as unknown as CovWindow).__cov;
    cov.gate[c] = new Promise<void>((resolve) => {
      cov.open[c] = resolve;
    });
  }, cmd);

export const release = (page: Page, cmd: string) =>
  page.evaluate((c) => {
    const cov = (window as unknown as CovWindow).__cov;
    cov.open[c]?.();
    delete cov.gate[c];
  }, cmd);

/** How many times `cmd` has been invoked (so a held call is known to be waiting). */
export const calls = (page: Page, cmd: string) =>
  page.evaluate(
    (c) => (window as unknown as CovWindow).__cov.log.filter((x) => x === c).length,
    cmd,
  );

/** Answers `cmd` with the result of the function body `body`, which sees the arguments as `a`. */
export const answerWith = (page: Page, cmd: string, body: string) =>
  page.evaluate(
    ([c, b]) => {
      (window as unknown as CovWindow).__cov.fn[c as string] = new Function(
        "a",
        b as string,
      ) as never;
    },
    [cmd, body],
  );

export const answer = (page: Page, cmd: string, value: unknown) =>
  page.evaluate(
    ([c, v]) => {
      (window as unknown as CovWindow).__cov.ret[c as string] = v;
    },
    [cmd, value],
  );

export const unanswer = (page: Page, cmd: string) =>
  page.evaluate((c) => {
    delete (window as unknown as CovWindow).__cov.ret[c];
  }, cmd);

/** Runs a menu command of the open book (dev builds expose them for the automation scripts). */
export async function menu(page: Page, id: string) {
  await page.waitForFunction(() => Boolean(window.__cadabraMenu));
  await page.evaluate((i) => window.__cadabraMenu.run(i), id);
}

/**
 * Closes the open book and opens `/proj` again from the start screen, after `edit` (run in the page, on `window.__disk`)
 * changed what is on the fake disk.
 */
export async function reopen<A>(page: Page, edit: (arg: A) => void, arg: A) {
  await menu(page, "file.close");
  await expect(page.getByRole("button", { name: "Open folder" })).toBeVisible();
  await page.evaluate(edit as never, arg);
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
}

/** For `reopen`: merges `patch` into the manifest on the fake disk. */
export const patchManifest = (patch: Record<string, unknown>) => {
  const disk = window.__disk;
  disk["cadabra.json"] = JSON.stringify({
    ...JSON.parse(disk["cadabra.json"] as string),
    ...patch,
  });
};
