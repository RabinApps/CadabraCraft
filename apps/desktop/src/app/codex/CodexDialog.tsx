import { useEffect, useMemo, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { ChevronLeft, Plus, Trash2, X } from "lucide-react";
import {
  MAX_CODEX_ALIAS,
  MAX_CODEX_BODY,
  MAX_CODEX_NAME,
  MAX_CODEX_SUMMARY,
  type CodexEntry,
  type CodexKind,
} from "@cadabracraft/format";
import { appearsIn, newCodexId, type ChapterScenes } from "../../lib/codex";
import { sceneRows } from "../../lib/scenes/scenes";
import { useProject } from "../../state/project/index";
import { useCodex } from "../../state/codex";
import { useChapterScenes } from "../scenes/useChapterScenes";
import { Button, IconButton } from "../../ui/Button";
import { Chip } from "../../ui/feedback/Chip";
import { cx } from "../../ui/cx";
import { overlayClass, panelClass } from "../../ui/Dialog";
import { Field } from "../../ui/forms/Input";

type Filter = "all" | CodexKind;

/**
 * The codex: the book's people, places, things and lore. A list on the left, the selected entry's notes on the right (the
 * list alone on a phone, with a back link), and the scenes that name the entry under them.
 */
export function CodexDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const root = useProject((s) => s.root);
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const doc = useProject((s) => s.currentDoc);
  const entries = useCodex((s) => s.entries);
  const error = useCodex((s) => s.error);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const kinds: [CodexKind, string][] = [
    ["character", t`Character`],
    ["place", t`Place`],
    ["item", t`Item`],
    ["lore", t`Lore`],
  ];
  const word = (kind: CodexKind) => kinds.find(([k]) => k === kind)?.[1] ?? kind;

  useEffect(() => {
    if (open && root) void useCodex.getState().load(root);
  }, [open, root]);

  const otherIds = useMemo(
    () => (manifest?.chapters ?? []).map((c) => c.id).filter((id) => id !== currentId),
    [manifest, currentId],
  );
  const otherScenes = useChapterScenes(otherIds);
  const chapters: ChapterScenes[] = useMemo(
    () =>
      (manifest?.chapters ?? []).map((c) => ({
        id: c.id,
        title: c.titles[Object.keys(c.titles)[0] ?? ""] ?? "",
        scenes: c.id === currentId ? sceneRows(doc) : (otherScenes[c.id] ?? []),
      })),
    [manifest, currentId, doc, otherScenes],
  );
  const shown = entries.filter((e) => filter === "all" || e.kind === filter);
  const save = (next: CodexEntry[]) => void useCodex.getState().save(next);
  const update = (patch: Partial<CodexEntry>) => {
    if (!selected) return;
    save(entries.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)));
  };
  const add = () => {
    const base = t`Untitled entry`;
    const taken = new Set(entries.map((e) => e.name.toLowerCase()));
    const name = taken.has(base.toLowerCase()) ? `${base} ${entries.length + 1}` : base;
    const entry: CodexEntry = {
      id: newCodexId(),
      kind: filter === "all" ? "character" : filter,
      name,
      aliases: [],
      summary: "",
      body: "",
      image: null,
      links: [],
    };
    save([...entries, entry]);
    setSelectedId(entry.id);
    setBack(false);
  };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          aria-describedby={undefined}
          className={cx(
            panelClass,
            "inset-x-0 bottom-0 flex h-[85dvh] flex-col overflow-hidden rounded-t-lg bg-surface md:inset-8 md:mx-auto md:max-w-3xl md:rounded-lg",
          )}
        >
          <D.Title className="sr-only">{t`Codex`}</D.Title>
          <div className="flex items-center justify-between gap-2 border-b border-border p-4">
            <h2 className="text-lead font-semibold">{t`Codex`}</h2>
            <D.Close asChild>
              <IconButton icon={X} label={t`Close codex`} />
            </D.Close>
          </div>
          {error && (
            <p
              role="alert"
              className="border-b border-border bg-warn-soft px-4 py-2 text-small text-warn"
            >
              {error}
            </p>
          )}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div
              className={cx(
                "flex w-full flex-col gap-2 border-border p-4 md:w-72 md:shrink-0 md:border-e md:overflow-y-auto",
                selected && !back ? "max-md:hidden" : "",
              )}
            >
              <div role="group" aria-label={t`Filter by kind`} className="flex flex-wrap gap-1.5">
                <Chip pressed={filter === "all"} onClick={() => setFilter("all")}>
                  {t`All`}
                </Chip>
                {kinds.map(([kind, label]) => (
                  <Chip key={kind} pressed={filter === kind} onClick={() => setFilter(kind)}>
                    {label}
                  </Chip>
                ))}
              </div>
              {shown.length === 0 ? (
                <p className="py-4 text-sm text-ink-muted">{t`Nothing here yet.`}</p>
              ) : (
                <ul
                  aria-label={t`Codex entries`}
                  className="m-0 flex list-none flex-col gap-0.5 p-0"
                >
                  {shown.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        aria-current={selectedId === e.id ? "true" : undefined}
                        onClick={() => {
                          setSelectedId(e.id);
                          setBack(false);
                        }}
                        className={cx(
                          "flex w-full flex-col rounded-md px-2 py-1.5 text-start hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent",
                          selectedId === e.id && "bg-raised",
                        )}
                      >
                        <span className="truncate text-sm font-medium">{e.name}</span>
                        <span className="truncate text-micro text-ink-muted">
                          {word(e.kind)}
                          {e.summary ? ` · ${e.summary}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="ghost" icon={Plus} className="justify-start" onClick={add}>
                {t`New entry`}
              </Button>
            </div>
            {selected ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setBack(true)}
                    className="flex items-center gap-1 rounded-md px-1 py-1.5 text-sm font-medium text-accent focus-visible:outline-2 focus-visible:outline-accent md:hidden"
                  >
                    <ChevronLeft size={14} aria-hidden />
                    {t`Back to entries`}
                  </button>
                  <IconButton
                    icon={Trash2}
                    label={t`Delete ${selected.name}`}
                    onClick={() => {
                      save(entries.filter((e) => e.id !== selected.id));
                      setSelectedId(null);
                    }}
                  />
                </div>
                <Field
                  key={`name-${selected.id}`}
                  label={t`Name`}
                  defaultValue={selected.name}
                  maxLength={MAX_CODEX_NAME}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== selected.name) update({ name });
                  }}
                />
                <div role="group" aria-label={t`Kind`} className="flex flex-wrap gap-1.5">
                  {kinds.map(([kind, label]) => (
                    <Chip
                      key={kind}
                      pressed={selected.kind === kind}
                      onClick={() => update({ kind })}
                    >
                      {label}
                    </Chip>
                  ))}
                </div>
                <Field
                  key={`summary-${selected.id}`}
                  label={t`Summary`}
                  defaultValue={selected.summary}
                  maxLength={MAX_CODEX_SUMMARY}
                  onBlur={(e) => update({ summary: e.target.value.trim() })}
                />
                <Field
                  key={`aliases-${selected.id}`}
                  label={t`Aliases (one per line)`}
                  defaultValue={selected.aliases.join("\n")}
                  maxLength={MAX_CODEX_ALIAS * 20}
                  onBlur={(e) =>
                    update({
                      aliases: e.target.value
                        .split("\n")
                        .map((a) => a.trim())
                        .filter(Boolean)
                        .slice(0, 50),
                    })
                  }
                />
                <Field
                  key={`links-${selected.id}`}
                  label={t`Links (one per line)`}
                  defaultValue={selected.links.join("\n")}
                  onBlur={(e) =>
                    update({
                      links: e.target.value
                        .split("\n")
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .slice(0, 50),
                    })
                  }
                />
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`codex-body-${selected.id}`}
                    className="text-xs font-semibold text-ink-muted"
                  >
                    {t`Notes`}
                  </label>
                  <textarea
                    id={`codex-body-${selected.id}`}
                    key={`body-${selected.id}`}
                    defaultValue={selected.body}
                    maxLength={MAX_CODEX_BODY}
                    rows={6}
                    onBlur={(e) => update({ body: e.target.value.trim() })}
                    className="min-h-28 w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 font-book text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </div>
                <section aria-label={t`Appears in`} className="flex flex-col gap-1">
                  <h3 className="text-xs font-semibold text-ink-muted">{t`Appears in`}</h3>
                  {appearsIn(selected, chapters).length === 0 ? (
                    <p className="text-sm text-ink-muted">{t`No scene names it yet.`}</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {appearsIn(selected, chapters).map((a) => (
                        <li key={`${a.chapterId}:${a.sceneId}`} className="text-sm">
                          {`${a.chapter} · ${a.scene || t`Untitled scene`}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : (
              <div className="hidden min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center md:flex">
                <p className="text-sm text-ink-muted">{t`Choose an entry, or add one.`}</p>
              </div>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
