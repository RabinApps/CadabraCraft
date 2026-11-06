import { t } from "@lingui/core/macro";
import {
  MAX_COMMENT_AUTHOR,
  MAX_COMMENT_BODY,
  MAX_COMMENT_REPLIES,
  MAX_COMMENT_THREADS,
  commentsProblem,
  sourceEdition,
  type CommentThread,
  type CommentsFile,
} from "@cadabracraft/format";
import { bridge } from "../../lib/bridge";
import { whyText } from "../../lib/projectError";
import { alertOf } from "./util";
import type { CommentActions } from "./types";
import type { Ctx } from "./context";

/** Where one page's threads live: beside the book (`comments/<page-id>.json`), synced and readable without the app. */
export const commentsFile = (pageId: string): string => `comments/${pageId}.json`;

/** The store patch for one page's sidecar: its threads, or an empty list plus an alert when the file cannot be opened (the file is left as it is). */
const readThreads = async (root: string, pageId: string) => {
  const none = { comments: [] as CommentThread[], commentsPageId: pageId };
  let read: Awaited<ReturnType<typeof bridge.readFile>>;
  try {
    read = await bridge.readFile(root, commentsFile(pageId));
  } catch (e) {
    return {
      ...alertOf(
        t`The comments for this page could not be read: ${whyText(e)}. The file was left as it is.`,
      ),
      ...none,
    };
  }
  if (!read) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.contents);
  } catch {
    return {
      ...alertOf(
        t`The comments for this page are not valid JSON, so they were not opened. The file was left untouched.`,
      ),
      ...none,
    };
  }
  const problem = commentsProblem(parsed);
  if (problem)
    return {
      ...alertOf(
        t`The comments for this page could not be opened: ${problem}. The file was left untouched.`,
      ),
      ...none,
    };
  return { ...none, comments: (parsed as CommentsFile).threads };
};

/** Comments for the open page: read the sidecar, add a thread, reply, resolve. Every change is written at once. */
export const createCommentActions = (ctx: Ctx): CommentActions => {
  const { set, get, need, writePage } = ctx;
  /** Who is writing: the book's author. Comments never carry an account (the app has none). */
  const author = (): string => {
    const name = sourceEdition(need().manifest.editions).author.trim();
    return (name || "Anonymous").slice(0, MAX_COMMENT_AUTHOR);
  };
  const write = async (pageId: string, threads: CommentThread[]): Promise<boolean> => {
    try {
      await writePage(commentsFile(pageId), `${JSON.stringify({ threads }, null, 2)}\n`);
      return true;
    } catch (e) {
      set(alertOf(t`Could not save the comments: ${whyText(e)}. Try again.`));
      return false;
    }
  };
  /** Shows the new list at once, and puts it back when the file could not be written. */
  const commit = async (pageId: string, next: CommentThread[]): Promise<void> => {
    const before = get().comments;
    set({ comments: next });
    if (!(await write(pageId, next))) set({ comments: before });
  };
  /** Replaces one thread; a thread that is not there (or a change that refuses) writes nothing. */
  const edit = async (
    threadId: string,
    change: (thread: CommentThread) => CommentThread | null,
  ): Promise<void> => {
    const pageId = get().commentsPageId;
    const before = get().comments.find((x) => x.id === threadId);
    if (!pageId || !before) return;
    const after = change(before);
    if (!after) return;
    await commit(
      pageId,
      get().comments.map((x) => (x.id === threadId ? after : x)),
    );
  };
  return {
    async loadComments(pageId) {
      if (!get().root) return;
      if (!pageId) {
        set({ comments: [], commentsPageId: null });
        return;
      }
      set(await readThreads(need().root, pageId));
    },
    async addComment(threadId, body) {
      const pageId = get().commentsPageId ?? get().currentId;
      const text = body.trim();
      if (!pageId || !text || text.length > MAX_COMMENT_BODY) return;
      const threads = get().comments;
      if (threads.some((x) => x.id === threadId)) return;
      if (threads.length >= MAX_COMMENT_THREADS) {
        set(alertOf(t`A page holds at most ${MAX_COMMENT_THREADS} comments.`));
        return;
      }
      await commit(pageId, [
        ...threads,
        {
          id: threadId,
          author: author(),
          body: text,
          created: new Date().toISOString(),
          resolved: false,
          replies: [],
        },
      ]);
    },
    async replyComment(threadId, body) {
      const text = body.trim();
      if (!text || text.length > MAX_COMMENT_BODY) return;
      const thread = get().comments.find((x) => x.id === threadId);
      if (!thread || thread.replies.length >= MAX_COMMENT_REPLIES) return;
      await edit(threadId, (x) => ({
        ...x,
        replies: [
          ...x.replies,
          { author: author(), body: text, created: new Date().toISOString() },
        ],
      }));
    },
    async resolveComment(threadId, resolved) {
      await edit(threadId, (x) => ({ ...x, resolved }));
    },
    dismissComments() {
      set({ comments: [], commentsPageId: null });
    },
  };
};
