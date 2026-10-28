// external.ts with the child-process layer replaced, so timeouts, a broken java and odd poppler failures can be made on demand.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  run: null as
    null | ((cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>),
  typst: null as null | (() => string),
}));

vi.mock("node:child_process", async (orig) => {
  const real = await orig<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const execFile = Object.assign((...a: Parameters<typeof real.execFile>) => real.execFile(...a), {
    [promisify.custom]: (cmd: string, args: string[]) => fake.run!(cmd, args),
  });
  return { ...real, execFile };
});
vi.mock("@cadabracraft/export-pdf/node", async (orig) => {
  const real = await orig<typeof import("@cadabracraft/export-pdf/node")>();
  return { ...real, findTypst: () => (fake.typst ? fake.typst() : real.findTypst()) };
});

import { findEpubcheck, poppler, runEpubcheck, typstPath } from "../external";
import type { Ctx } from "../tooling";

const ctx = (over: Partial<Ctx> = {}): Ctx => ({ ws: {} as never, repo: null, ...over });
const jar = () => {
  const p = join(mkdtempSync(join(tmpdir(), "mcp-ext-")), "epubcheck.jar");
  writeFileSync(p, "x");
  return p;
};
const failure = (props: object) => Object.assign(new Error("failed"), props);

afterEach(() => {
  fake.run = fake.typst = null;
  vi.unstubAllEnvs();
});

describe("findEpubcheck", () => {
  it("is null when disabled, and prefers an explicit jar", () => {
    expect(findEpubcheck(ctx({ epubcheckJar: null }))).toBeNull();
    const j = jar();
    expect(findEpubcheck(ctx({ epubcheckJar: j }))).toBe(j);
    expect(findEpubcheck(ctx({ epubcheckJar: "/no/such.jar" }))).toBeNull();
  });
  it("falls back to EPUBCHECK_JAR, then to the checkout, then to nothing", () => {
    const j = jar();
    vi.stubEnv("EPUBCHECK_JAR", j);
    expect(findEpubcheck(ctx())).toBe(j);
    vi.stubEnv("EPUBCHECK_JAR", "");
    expect(findEpubcheck(ctx({ repo: "/no/such/checkout" }))).toBeNull();
    expect(findEpubcheck(ctx())).toBeNull();
  });
});

describe("runEpubcheck", () => {
  it("skips when there is no jar", async () => {
    const r = await runEpubcheck(ctx({ epubcheckJar: null }), "x.epub");
    expect(r).toMatchObject({ ran: false, messages: [] });
    expect(r.reason).toContain("jar not found");
  });

  it("skips when java does not run", async () => {
    fake.run = async () => {
      throw failure({ code: "ENOENT" });
    };
    const r = await runEpubcheck(ctx({ epubcheckJar: jar() }), "x.epub");
    expect(r).toEqual({ ran: false, messages: [], reason: "java was not found or does not work" });
  });

  it("reports a timeout as not run", async () => {
    fake.run = async (_cmd, args) => {
      if (args[0] === "-version") return { stdout: "", stderr: "" };
      throw failure({ killed: true });
    };
    const r = await runEpubcheck(ctx({ epubcheckJar: jar() }), "x.epub");
    expect(r).toEqual({ ran: false, messages: [], reason: "EPUBCheck timed out" });
  });

  it("passes on a clean run and keeps the summary line", async () => {
    fake.run = async (_cmd, args) => ({
      stdout: args[0] === "-version" ? "" : "INFO(X): note\nNo errors or warnings detected.\n",
      stderr: "",
    });
    const r = await runEpubcheck(ctx({ epubcheckJar: jar() }), "x.epub");
    expect(r).toEqual({
      ran: true,
      passed: true,
      messages: ["INFO(X): note"],
      summary: "No errors or warnings detected.",
    });
  });

  it("fails on a non-zero exit, reading the messages from the failed process, with or without output", async () => {
    fake.run = async (_cmd, args) => {
      if (args[0] === "-version") return { stdout: "", stderr: "" };
      throw failure({
        code: 1,
        stdout: "ERROR(RSC-005): a.xhtml: bad\n",
        stderr: "Check finished with errors\n",
      });
    };
    const r = await runEpubcheck(ctx({ epubcheckJar: jar() }), "x.epub");
    expect(r.passed).toBe(false);
    expect(r.messages).toEqual(["ERROR(RSC-005): a.xhtml: bad"]);
    expect(r.summary).toBe("Check finished with errors");

    fake.run = async (_cmd, args) => {
      if (args[0] === "-version") return { stdout: "", stderr: "" };
      throw failure({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
    };
    const bare = await runEpubcheck(ctx({ epubcheckJar: jar() }), "x.epub");
    expect(bare).toEqual({ ran: true, passed: false, messages: [] });
  });

  it("fails on a warning even when the exit code is zero", async () => {
    fake.run = async (_cmd, args) => ({
      stdout: args[0] === "-version" ? "" : "WARNING(OPF-1): w\n",
      stderr: "",
    });
    expect((await runEpubcheck(ctx({ epubcheckJar: jar() }), "x.epub")).passed).toBe(false);
  });
});

describe("typstPath", () => {
  it("prefers the explicit binary", () => {
    expect(typstPath(ctx({ typstBin: "/x/typst" }))).toBe("/x/typst");
  });
  it("uses what typst lookup finds", () => {
    fake.typst = () => "/found/typst";
    expect(typstPath(ctx())).toBe("/found/typst");
  });
  it("falls back to the Homebrew folders when the lookup throws", () => {
    fake.typst = () => {
      throw new Error("not on PATH");
    };
    const r = typstPath(ctx());
    expect(r === undefined || r.endsWith("/typst")).toBe(true);
  });
});

describe("poppler", () => {
  it("is null when poppler is turned off", async () => {
    expect(await poppler(ctx({ popplerDir: null }), "pdfinfo", [])).toBeNull();
  });
  it("runs the tool from the given folder", async () => {
    fake.run = async (cmd) => ({ stdout: `ran ${cmd}`, stderr: "" });
    expect(await poppler(ctx({ popplerDir: "/p" }), "pdfinfo", ["f"])).toBe("ran /p/pdfinfo");
  });
  it("tries the next location when a tool is missing, and gives up with null", async () => {
    const tried: string[] = [];
    fake.run = async (cmd) => {
      tried.push(cmd);
      if (tried.length < 3) throw failure({ code: "ENOENT" });
      return { stdout: "ok", stderr: "" };
    };
    expect(await poppler(ctx(), "pdftotext", [])).toBe("ok");
    expect(tried).toEqual(["pdftotext", "/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext"]);
    fake.run = async () => {
      throw failure({ code: "ENOENT" });
    };
    expect(await poppler(ctx(), "pdftotext", [])).toBeNull();
  });
  it("passes on any other failure", async () => {
    fake.run = async () => {
      throw failure({ code: 1 });
    };
    await expect(poppler(ctx(), "pdfinfo", [])).rejects.toThrow("failed");
  });
});
