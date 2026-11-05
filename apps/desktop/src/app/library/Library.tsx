import { useMemo, useState } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, FolderPlus, LayoutGrid, List, Search, X } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Input";
import { Notice } from "../../ui/Notice";
import { Segmented } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
import { bridge } from "../../lib/bridge";
import { coverThumbs } from "../../lib/coverThumbs";
import { errText } from "../../lib/projectError";
import { relativeTime } from "../../lib/relativeTime";
import { useLibraryPrefs } from "../../state/library";
import { useRecents, type Recent } from "../../state/recents";
import { BookCover } from "./BookCover";
import {
  groupBySeries,
  infoOf,
  searchBooks,
  sortBooks,
  SORTS,
  type BookGroup,
  type LibrarySort,
} from "./libraryModel";
import { useOpenBook } from "./useOpenBook";

interface Props {
  onBack: () => void;
  onOpenRecent: (root: string) => Promise<void>;
}

/** Every book the app knows about: covers, sort, search and series groups. Opening one is the same flow as on Home. */
export function Library({ onBack, onOpenRecent }: Props) {
  const { t, i18n } = useLingui();
  const { recents, remove, addScanned } = useRecents();
  const { sort, layout, groupBySeries: grouped, set } = useLibraryPrefs();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const { open, problems, forget } = useOpenBook(onOpenRecent);

  const shown = useMemo(
    () => sortBooks(searchBooks(recents, query), sort, i18n.locale),
    [recents, query, sort, i18n.locale],
  );
  const groups: BookGroup[] = useMemo(
    () => (grouped ? groupBySeries(shown) : [{ series: null, books: shown }]),
    [grouped, shown],
  );
  const hasSeries = groups.some((g) => g.series !== null);

  const sortLabels: Record<LibrarySort, string> = {
    edited: t`Last edited`,
    title: t`Title`,
    author: t`Author`,
    words: t`Most words`,
    series: t`Series order`,
  };

  const scan = async () => {
    setError("");
    setMessage("");
    setScanning(true);
    try {
      const folder = await bridge.pickLibraryFolder();
      if (!folder) return;
      const found = await bridge.scanLibrary(folder);
      const added = addScanned(
        found.books.map((b) => ({
          root: b.root,
          title: b.title,
          author: b.author,
          ...(b.cover ? { cover: b.cover } : {}),
          ...(b.series ? { series: b.series } : {}),
          ...(b.series && b.seriesNumber ? { seriesNumber: b.seriesNumber } : {}),
        })),
      );
      const parts = [
        plural(added, { one: "Added # new book.", other: "Added # new books." }),
        found.books.length - added > 0
          ? t`${found.books.length - added} were already in the Library.`
          : "",
        found.skipped > 0
          ? plural(found.skipped, {
              one: "# folder with a damaged cadabra.json was skipped.",
              other: "# folders with a damaged cadabra.json were skipped.",
            })
          : "",
        found.truncated
          ? t`The folder holds more books than a scan lists; pick a smaller folder.`
          : "",
      ];
      setMessage(parts.filter(Boolean).join(" "));
    } catch (e) {
      setError(errText(e));
    } finally {
      setScanning(false);
    }
  };

  const removeBook = (r: Recent) => {
    const cover = infoOf(r).cover;
    if (cover) void coverThumbs.forget(r.root, cover);
    remove(r.root);
    forget(r.root);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-3.5 md:px-16">
        <Button icon={ArrowLeft} onClick={onBack}>{t`Home`}</Button>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-10 md:px-16">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="font-book text-heading font-semibold md:text-display">{t`Library`}</h1>
            <p role="status" className="text-sm text-ink-muted">
              {query.trim() === ""
                ? plural(recents.length, { one: "# book", other: "# books" })
                : t`${shown.length} of ${plural(recents.length, { one: "# book", other: "# books" })}`}
            </p>
          </div>
          <Button icon={FolderPlus} onClick={() => void scan()} disabled={scanning}>
            {scanning ? t`Looking for books…` : t`Add a folder of books…`}
          </Button>
        </div>
        {error && <Notice role="alert">{error}</Notice>}
        {message && (
          <Notice tone="accent" role="status">
            {message}
          </Notice>
        )}
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <div className="relative md:w-80">
            <Field
              label={t`Search books`}
              hideLabel
              type="search"
              placeholder={t`Search title, author or series`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="ps-9"
            />
            <Search
              size={16}
              aria-hidden
              className="pointer-events-none absolute inset-s-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
          </div>
          <div className="md:w-48">
            <Select
              label={t`Sort by`}
              value={sort}
              onChange={(e) => set({ sort: e.target.value as LibrarySort })}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {sortLabels[s]}
                </option>
              ))}
            </Select>
          </div>
          <Segmented
            label={t`Layout`}
            value={layout}
            onChange={(v) => set({ layout: v })}
            items={[
              { value: "grid", label: t`Covers`, icon: LayoutGrid, collapse: true },
              { value: "list", label: t`List`, icon: List, collapse: true },
            ]}
          />
          <Checkbox
            label={t`Group by series`}
            checked={grouped}
            onChange={(e) => set({ groupBySeries: e.target.checked })}
          />
        </div>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            {recents.length === 0
              ? t`No books yet. Add a folder of books, or start a new one from Home.`
              : t`No book matches “${query.trim()}”.`}
          </p>
        ) : (
          groups.map((g) => (
            <section
              key={g.series ?? "\u0000none"}
              aria-label={g.series ?? t`Books without a series`}
              className="flex flex-col gap-3"
            >
              {hasSeries && (
                <h2 className="text-subtitle font-semibold">
                  {g.series ?? t`Not in a series`}
                  <span className="ms-2 text-small font-normal text-ink-muted">
                    {plural(g.books.length, { one: "# book", other: "# books" })}
                  </span>
                </h2>
              )}
              <ul
                className={
                  layout === "grid"
                    ? "grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5"
                    : "flex flex-col gap-2"
                }
              >
                {g.books.map((r) => (
                  <LibraryBook
                    key={r.root}
                    recent={r}
                    layout={layout}
                    problem={problems.get(r.root)}
                    onOpen={() => void open(r.root)}
                    onRemove={() => removeBook(r)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}

interface BookProps {
  recent: Recent;
  layout: "grid" | "list";
  problem: string | undefined;
  onOpen: () => void;
  onRemove: () => void;
}

function LibraryBook({ recent, layout, problem, onOpen, onRemove }: BookProps) {
  const { t, i18n } = useLingui();
  const info = infoOf(recent);
  const title = recent.title || t`Untitled`;
  const size =
    info.words === null
      ? t`Not opened yet`
      : t`${plural(info.chapters ?? 0, { one: "# chapter", other: "# chapters" })} · ${plural(info.words, { one: "# word", other: "# words" })}`;
  const when = relativeTime(info.editedAt, Date.now(), i18n.locale);
  // A book found by a scan was never opened here: it has no time to show.
  const edited =
    recent.openedAt === 0 && !recent.editedAt
      ? ""
      : recent.editedAt
        ? t`Edited ${when}`
        : t`Opened ${when}`;
  const badge = info.seriesNumber ? t`Book ${info.seriesNumber}` : null;
  const grid = layout === "grid";
  return (
    <li
      className={
        grid
          ? "relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
          : "relative flex flex-wrap items-center overflow-hidden rounded-lg border border-border bg-surface"
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className={
          grid
            ? "flex flex-col text-start hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            : "flex min-w-0 flex-1 items-center gap-4 pe-14 text-start hover:bg-accent-soft/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        }
      >
        <BookCover
          recent={recent}
          decorative
          className={grid ? "h-44" : "h-20 w-14 shrink-0 p-1.5 text-small"}
        />
        <span className="flex min-w-0 flex-col gap-1 p-3.5">
          <span className="truncate text-sm font-semibold">{title}</span>
          {info.author ? (
            <span className="truncate text-xs text-ink-muted">{info.author}</span>
          ) : null}
          <span className="text-xs text-ink-muted">{size}</span>
          {edited ? <span className="text-xs text-ink-muted">{edited}</span> : null}
        </span>
      </button>
      {badge && (
        <span className="pointer-events-none absolute inset-s-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-micro font-bold text-accent">
          {badge}
        </span>
      )}
      {problem && (
        <p role="alert" className="basis-full px-3.5 pb-3 text-xs text-danger">
          {problem}
        </p>
      )}
      <IconButton
        icon={X}
        label={t`Remove ${title} from the Library`}
        onClick={onRemove}
        className={grid ? "absolute inset-e-2 top-2 bg-surface/85" : "absolute inset-e-2 top-2"}
      />
    </li>
  );
}
