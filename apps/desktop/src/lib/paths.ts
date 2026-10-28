/** The last part of a path, whichever separator it uses. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** A file name without its last extension. */
export const stem = (name: string): string => name.replace(/\.[^.]*$/, "");
