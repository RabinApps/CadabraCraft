import type { ImportWarning, WarningSeverity } from "../types";

const MAX_INDIVIDUAL = 25;
const MAX_EXAMPLES = 5;

/** Collects warnings. `at` keeps per-location warnings (capped per code); `tally` aggregates counts and examples. */
export class Warnings {
  private located = new Map<
    string,
    { list: ImportWarning[]; extra: number; sev: WarningSeverity }
  >();
  private tallies = new Map<string, ImportWarning>();
  private order: string[] = [];

  at(code: string, severity: WarningSeverity, message: string, line?: number): void {
    let e = this.located.get(code);
    if (!e) {
      e = { list: [], extra: 0, sev: severity };
      this.located.set(code, e);
      this.order.push(`L:${code}`);
    }
    if (e.list.length < MAX_INDIVIDUAL)
      e.list.push({ code, severity, message, ...(line ? { line } : {}) });
    else e.extra++;
  }

  tally(code: string, severity: WarningSeverity, message: string, example?: string): void {
    let w = this.tallies.get(code);
    if (!w) {
      w = { code, severity, message, count: 0, examples: [] };
      this.tallies.set(code, w);
      this.order.push(`T:${code}`);
    }
    w.count = (w.count ?? 0) + 1;
    const ex = example?.replace(/\s+/g, " ").trim().slice(0, 80);
    if (ex && w.examples && w.examples.length < MAX_EXAMPLES && !w.examples.includes(ex))
      w.examples.push(ex);
  }

  list(): ImportWarning[] {
    const out: ImportWarning[] = [];
    for (const key of this.order) {
      const code = key.slice(2);
      if (key[0] === "L") {
        const e = this.located.get(code)!;
        out.push(...e.list);
        if (e.extra > 0)
          out.push({
            code,
            severity: e.sev,
            message: `${e.extra} more occurrences of this warning were omitted`,
            count: e.extra,
          });
      } else {
        const w = { ...this.tallies.get(code)! };
        if (w.examples?.length === 0) delete w.examples;
        out.push(w);
      }
    }
    return out;
  }
}
