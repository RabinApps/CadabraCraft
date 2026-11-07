import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import type { DiffLine } from "../../../lib/wordDiff";
import type { Compared } from "./chapterCompare";

/** One part of a compared line: plain, inserted or deleted text. */
function DiffPart({ part }: { part: DiffLine[number] }) {
  const { t } = useLingui();
  if (part.kind === "add") {
    return (
      <ins className="rounded-sm bg-success-soft px-0.5 text-success underline">
        <span className="sr-only">{t`Inserted:`} </span>
        {part.text}
      </ins>
    );
  }
  if (part.kind === "del") {
    return (
      <del className="rounded-sm bg-danger-soft px-0.5 text-danger line-through">
        <span className="sr-only">{t`Deleted:`} </span>
        {part.text}
      </del>
    );
  }
  return <>{part.text}</>;
}

/** The legend and the compared text of the chosen version; `note` is shown above the text (the chapter is gone from the book, say). */
export function Comparison({
  chosen,
  label,
  note,
}: {
  chosen: Compared | undefined;
  /** The accessible name of the compared text. */
  label: string;
  note?: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5 text-xs">
        <span className="text-ink-muted">{t`Compared with the current text`}</span>
        <ins className="rounded-sm bg-success-soft px-2 py-0.5 font-semibold text-success underline">{t`In this version only`}</ins>
        <del className="rounded-sm bg-danger-soft px-2 py-0.5 font-semibold text-danger line-through">{t`Only in the current text`}</del>
      </div>
      <div
        aria-label={label}
        className="flex max-h-[340px] min-h-40 flex-col gap-3 overflow-y-auto rounded-md border border-border bg-paper p-5 font-book text-base text-ink md:max-h-[360px]"
      >
        {note}
        {chosen && chosen.words !== null && chosen.added === 0 && chosen.removed === 0 && (
          <p className="font-ui text-sm text-ink-muted">{t`This version has the same words as the current text.`}</p>
        )}
        {chosen?.lines.map((line, i) => (
          <p key={i} className="m-0">
            {line.map((part, j) => (
              <span key={j}>
                {j > 0 && " "}
                <DiffPart part={part} />
              </span>
            ))}
          </p>
        ))}
      </div>
    </div>
  );
}
