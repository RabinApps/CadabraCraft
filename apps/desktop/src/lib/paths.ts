/** The last part of a path, whichever separator it uses. */
export const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/** A file name without its last extension. */
export const stem = (name: string): string => name.replace(/\.[^.]*$/, "");
