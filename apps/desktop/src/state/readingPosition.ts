import { create } from "zustand";

/** Where the reader is in the continuous book: the chapter at the reading line and, in page format, the page number printed there. */
export const useReadingPosition = create<{ id: string | null; page: number | null }>(() => ({
  id: null,
  page: null,
}));

export const setReadingPosition = (id: string | null, page: number | null): void =>
  useReadingPosition.setState((s) => (s.id === id && s.page === page ? s : { id, page }));
