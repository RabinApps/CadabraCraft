/** True on macOS, where menus and shortcuts use the Command key and its symbols. */
export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
