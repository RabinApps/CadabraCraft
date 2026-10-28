export class FormatError extends Error {}

/** True for paths that stay inside the project: relative, "/" separated, no "..", no drive letters. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.includes("\\") || /^[A-Za-z]:/.test(p)) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== ".." && seg !== ".");
}
