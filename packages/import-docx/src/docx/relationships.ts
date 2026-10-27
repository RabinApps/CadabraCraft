import { attr, childrenNamed, parseXml, tagOf } from "./xml";
import type { Rel } from "./types";

export function parseRels(bytes: Uint8Array | undefined, name: string): Map<string, Rel> {
  const map = new Map<string, Rel>();
  if (!bytes) return map;
  const root = parseXml(bytes, name).find((n) => tagOf(n) === "Relationships");
  if (!root) return map;
  for (const r of childrenNamed(root, "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (id && target) map.set(id, { target, external: attr(r, "TargetMode") === "External" });
  }
  return map;
}

export function resolvePart(target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `word/${target}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}
