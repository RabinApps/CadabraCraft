import type { Locator, Page } from "./coverage";

/**
 * The page cards a page stack draws, and their numbers once they have settled. A page's words are counted after it opens, and the
 * book's layout is redone when an editor measures the page or Typst reports, so after a book change a card can still print the
 * previous layout's number (or none) for a moment: a single read can catch a number that is about to be replaced. The `settled*`
 * helpers read until the value holds.
 */

/** A card as the DOM draws it. */
export interface Card {
  /** The number printed on the card ("" when it prints none). */
  folio: string;
  /** Physical page of the book. */
  physical: number;
  blank: boolean;
}

/** The cards of `scope` (a page stack's scroller), read in one pass. */
export const cardsOf = (scope: Locator): Promise<Card[]> =>
  scope.locator(".page").evaluateAll((els) =>
    els.map((e) => {
      const el = e as HTMLElement;
      return {
        folio: el.dataset.page ?? "",
        physical: Number(el.dataset.physical),
        blank: el.dataset.blank === "true",
      };
    }),
  );

/** The cards of the open page in Write mode. */
export const writeCards = (page: Page): Promise<Card[]> => cardsOf(page.getByTestId("page-scroll"));

/** The card the entry opens on (not the blank verso before it). */
export const opening = (cards: Card[]) => cards.find((c) => !c.blank);

/** The page's last card. */
export const lastOf = (cards: Card[]) => cards[cards.length - 1];

/**
 * How often a value is sampled and how long a read waits for it: three samples 150 ms apart, so it must hold for 300 ms.
 */
const STEP = 150;
const TIMEOUT = 10_000;

/** The number a page card prints, once the book has placed it. */
export async function settledFolio(card: Locator): Promise<number> {
  let last = "";
  let same = 0;
  for (let waited = 0; waited < TIMEOUT; waited += STEP) {
    const text = (await card.getAttribute("data-page")) ?? "";
    same = /^\d+$/.test(text) && text === last ? same + 1 : 0;
    last = text;
    if (same >= 2) return Number(text);
    await new Promise((resolve) => setTimeout(resolve, STEP));
  }
  throw new Error(`the page's number did not settle: last read "${last}"`);
}

/**
 * A page's cards once they have stopped changing and one of them prints a number: the first cards have none while the page's words
 * are counted, and the stack is redrawn as the count arrives.
 */
export async function settledCards(page: Page): Promise<Card[]> {
  let last = "";
  let same = 0;
  for (let waited = 0; waited < TIMEOUT; waited += STEP) {
    const cards = await writeCards(page);
    const sig = JSON.stringify(cards);
    same = cards.length > 0 && opening(cards)?.folio && sig === last ? same + 1 : 0;
    last = sig;
    if (same >= 2) return cards;
    await new Promise((resolve) => setTimeout(resolve, STEP));
  }
  throw new Error(`the page's cards did not settle: last read ${last}`);
}
