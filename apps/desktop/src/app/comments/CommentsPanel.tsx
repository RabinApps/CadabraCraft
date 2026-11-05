import { useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { MessageSquareText, X } from "lucide-react";
import type { CommentThread } from "@cadabracraft/format";
import {
  commentAnchors,
  commentQuote,
  newCommentId,
  relativeTime,
  splitThreads,
} from "../../lib/comments";
import { useCommentAnchor } from "../../lib/commentAnchor";
import { useProject } from "../../state/project/index";
import { Button, IconButton } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Field } from "../../ui/Input";

type Filter = "open" | "resolved";

/** One thread: who wrote it and when, the text it is anchored to, the comment, its replies, and what can be done. */
function Thread({
  thread,
  quote,
  detached,
  onReply,
  onResolve,
}: {
  thread: CommentThread;
  quote: string;
  detached: boolean;
  onReply: (body: string) => void;
  onResolve: (resolved: boolean) => void;
}) {
  const { t } = useLingui();
  const [replying, setReplying] = useState(false);
  const [body, setBody] = useState("");
  return (
    <li
      className={
        thread.resolved
          ? "flex flex-col gap-2 rounded-md bg-bg p-3 opacity-65"
          : "flex flex-col gap-2 rounded-md bg-bg p-3"
      }
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-semibold text-accent uppercase"
        >
          {thread.author.slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1 truncate text-small font-semibold">{thread.author}</span>
        <span className="shrink-0 text-micro text-ink-muted">{relativeTime(thread.created)}</span>
      </div>
      {quote && <p className="rounded-sm bg-accent-soft p-2 font-book text-small">{quote}</p>}
      {detached && (
        <p className="text-micro font-semibold text-warn">
          {t`The text this was attached to is gone; the comment is kept.`}
        </p>
      )}
      <p className="text-small whitespace-pre-wrap">{thread.body}</p>
      {thread.replies.map((r, i) => (
        <div key={i} className="flex flex-col gap-1 rounded-sm bg-surface p-2">
          <p className="text-micro font-semibold text-ink-muted">
            {`${r.author} · ${relativeTime(r.created)}`}
          </p>
          <p className="text-small whitespace-pre-wrap">{r.body}</p>
        </div>
      ))}
      {replying ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = body.trim();
            if (!text) return;
            onReply(text);
            setBody("");
            setReplying(false);
          }}
        >
          <Field
            label={t`Reply to ${thread.author}`}
            placeholder={t`Reply…`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              {t`Cancel`}
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!body.trim()}>
              {t`Reply`}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="rounded-sm text-caption font-semibold text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t`Reply`}
          </button>
          <button
            type="button"
            onClick={() => onResolve(!thread.resolved)}
            className="rounded-sm text-caption text-ink-muted focus-visible:outline-2 focus-visible:outline-accent"
          >
            {thread.resolved ? t`Reopen` : t`Resolve`}
          </button>
        </div>
      )}
    </li>
  );
}

/** The comments rail: this page's threads, open or resolved, and a box to start one on the selected text. */
export function CommentsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useLingui();
  const threads = useProject((s) => s.comments);
  const doc = useProject((s) => s.currentDoc);
  const pageId = useProject((s) => s.currentId);
  const actions = useProject((s) => s.actions);
  const insert = useCommentAnchor((s) => s.insert);
  const canAnchor = useCommentAnchor((s) => s.hasSelection && s.insert !== null);
  const [filter, setFilter] = useState<Filter>("open");
  const [draft, setDraft] = useState("");
  const anchors = useMemo(() => commentAnchors(doc), [doc]);
  const { detached } = useMemo(() => splitThreads(threads, anchors), [threads, anchors]);
  const detachedIds = useMemo(() => new Set(detached.map((x) => x.id)), [detached]);
  const open = threads.filter((x) => !x.resolved).length;
  const shown = threads.filter((x) => (filter === "resolved" ? x.resolved : !x.resolved));
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    const id = newCommentId();
    if (!body || !insert || !insert(id)) return;
    void actions.addComment(id, body);
    setDraft("");
  };
  return (
    <section aria-label={t`Comments`} className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lead font-semibold">{t`Comments`}</h2>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-caption font-semibold text-accent">
            {t`${open} open`}
          </span>
          {onClose && <IconButton icon={X} label={t`Close comments`} onClick={onClose} />}
        </div>
      </div>
      <div role="group" aria-label={t`Filter comments`} className="flex gap-1.5">
        <Chip pressed={filter === "open"} onClick={() => setFilter("open")}>
          {t`Open`}
        </Chip>
        <Chip pressed={filter === "resolved"} onClick={() => setFilter("resolved")}>
          {t`Resolved`}
        </Chip>
      </div>
      {!pageId ? (
        <p className="py-6 text-center text-sm text-ink-muted">{t`Open a page to see its comments.`}</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <MessageSquareText size={22} aria-hidden />
          </span>
          <p className="text-sm text-ink-muted">
            {filter === "open"
              ? t`No open comments on this page.`
              : t`No resolved comments on this page.`}
          </p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {shown.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              quote={commentQuote(doc, thread.id)}
              detached={detachedIds.has(thread.id)}
              onReply={(body) => void actions.replyComment(thread.id, body)}
              onResolve={(resolved) => void actions.resolveComment(thread.id, resolved)}
            />
          ))}
        </ul>
      )}
      <form className="mt-auto flex flex-col gap-2" onSubmit={add}>
        <Field
          label={t`New comment`}
          placeholder={canAnchor ? t`Comment on the selection` : t`Select text to comment on`}
          value={draft}
          disabled={!canAnchor}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          type="submit"
          className="self-end"
          disabled={!canAnchor || !draft.trim()}
        >
          {t`Add comment`}
        </Button>
      </form>
    </section>
  );
}
