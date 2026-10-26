/** Message of anything thrown (non-Error values are stringified). */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
