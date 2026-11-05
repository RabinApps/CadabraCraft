import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { cx } from "../../ui/cx";
import { coverThumbs } from "../../lib/coverThumbsBrowser";
import type { Recent } from "../../state/recents";
import { infoOf } from "./libraryModel";

const TONES = ["bg-accent-soft", "bg-success-soft", "bg-warn-soft"] as const;

/** A steady tint per book, so a cover keeps its colour while the list changes. */
const toneOf = (root: string) =>
  TONES[
    [...root].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261) %
      TONES.length
  ];

/** The thumbnail of a book's cover as an object URL; null until it is ready and for a book with no readable cover. */
function useThumb(root: string, cover: string | undefined): string | null {
  const [state, setState] = useState<{ key: string; url: string | null }>({ key: "", url: null });
  const key = cover ? `${root}\u0000${cover}` : "";
  useEffect(() => {
    if (!cover) return;
    let live = true;
    void coverThumbs.get(root, cover).then((url) => live && setState({ key, url }));
    return () => {
      live = false;
    };
  }, [root, cover, key]);
  return state.key === key ? state.url : null;
}

/** The book's cover picture when it has one that can be read, otherwise the title on a tint. */
export function BookCover({
  recent,
  className,
  decorative,
}: {
  recent: Recent;
  className: string;
  /** The title is written next to the cover, so a screen reader skips the one drawn on it. */
  decorative?: boolean;
}) {
  const { t } = useLingui();
  const url = useThumb(recent.root, infoOf(recent).cover);
  const title = recent.title || t`Untitled`;
  if (url)
    return (
      <span className={cx("flex overflow-hidden bg-border", className)}>
        <img src={url} alt="" className="size-full object-cover" />
      </span>
    );
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cx("flex flex-col justify-end p-4", toneOf(recent.root), className)}
    >
      <span className="font-book text-heading font-semibold text-ink">{title}</span>
    </span>
  );
}
