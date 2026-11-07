import { create } from "zustand";

/** Where the reader is in the continuous book: the chapter at the reading line and, in page format, the number printed on the page there ("12", "iv"; null in the plain reading layout). */
export const useReadingPosition = create<{ id: string | null; page: string | null }>(() => ({
  id: null,
  page: null,
}));

export const setReadingPosition = (id: string | null, page: string | null): void =>
  useReadingPosition.setState((s) => (s.id === id && s.page === page ? s : { id, page }));
