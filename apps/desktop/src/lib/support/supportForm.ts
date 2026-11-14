/** The support desk that hosts the Contact and Feedback forms. Reached only when the author opens a form. */
export const SUPPORT_ORIGIN = "https://support.cadabracraft.com";

export type SupportForm = "contact" | "feedback";

/** The address of a form page that is made to sit inside another page. */
export const supportFormUrl = (form: SupportForm): string => `${SUPPORT_ORIGIN}/embed/${form}`;

/** Height range the form frame may take: a message cannot make the dialog empty or taller than any window. */
export const FORM_MIN_HEIGHT = 240;
export const FORM_MAX_HEIGHT = 1600;
/** Used until the form reports its own height (the embed snippet asks for 520). */
export const FORM_DEFAULT_HEIGHT = 520;
/**
 * The least height each form's frame gets, whatever height the form reports: the feedback form asks for 520 but is
 * taller, so its Send button would sit below the frame.
 */
export const FORM_FRAME_FLOOR: Record<SupportForm, number> = {
  contact: FORM_DEFAULT_HEIGHT,
  feedback: 700,
};

/** The height of a form's frame: what the form reported (if anything), but not below that form's floor. */
export const frameHeight = (form: SupportForm, reported: number | null): number =>
  Math.max(FORM_FRAME_FLOOR[form], reported ?? 0);

/** How long the form may take to load before the dialog offers the browser instead. */
export const FORM_LOAD_TIMEOUT_MS = 12_000;

/**
 * The height the form asks for in a `supdesk:height` message, or null when the message is anything else: from another
 * window, from another origin, or not shaped like the form's message.
 */
export function formHeightFrom(
  event: { origin: string; source: unknown; data: unknown },
  frame: unknown,
): number | null {
  if (!frame || event.source !== frame || event.origin !== SUPPORT_ORIGIN) return null;
  const data = event.data as { type?: unknown; height?: unknown } | null;
  if (!data || typeof data !== "object" || data.type !== "supdesk:height") return null;
  if (typeof data.height !== "number" || !Number.isFinite(data.height)) return null;
  return Math.min(FORM_MAX_HEIGHT, Math.max(FORM_MIN_HEIGHT, Math.round(data.height)));
}
