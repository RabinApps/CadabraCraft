/**
 * Comments: a thread anchored to a passage of one page. The anchor travels in the chapter JSON as a `comment` mark
 * (`attrs.id`), and the thread itself lives beside the book in `comments/<page-id>.json`, so an editor who opens the
 * folder sees the comments without the app and nothing about them reaches an export.
 *
 * A thread whose anchored text is deleted is not deleted with it: the app keeps it and shows it as detached, because a
 * person's words are never thrown away by an edit.
 */
import { isValidCommentId } from "@cadabracraft/shared";

/** Longest comment body, in characters (line breaks allowed). */
export const MAX_COMMENT_BODY = 10000;
/** Longest author name or reply author, in characters. */
export const MAX_COMMENT_AUTHOR = 200;
/** Most replies one thread may hold. */
export const MAX_COMMENT_REPLIES = 200;
/** Most threads one page may hold. */
export const MAX_COMMENT_THREADS = 500;

export interface CommentReply {
  /** Who wrote it: the name from the app's preferences, never an account. */
  author: string;
  body: string;
  /** ISO 8601 date and time. */
  created: string;
}

export interface CommentThread {
  /** Matches the `attrs.id` of the thread's `comment` mark in the chapter JSON. */
  id: string;
  author: string;
  body: string;
  created: string;
  /** True once the thread is dealt with; still kept and still exported nowhere. */
  resolved: boolean;
  replies: CommentReply[];
}

/** One page's comments, as `comments/<page-id>.json` holds them. */
export interface CommentsFile {
  threads: CommentThread[];
}

/** Control characters a one-line name or author may not hold, tab and line breaks included. */
// eslint-disable-next-line no-control-regex -- intentional: this is the list of forbidden control characters
const CONTROL_IN_LINE = /[\u0000-\u001F\u007F]/;
/** Control characters a body may not hold; tab, line feed and carriage return are allowed through. */
// eslint-disable-next-line no-control-regex -- intentional: this is the list of forbidden control characters
const CONTROL_IN_BODY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** A trimmed single-line string of at most `max` characters; null when `v` is not one. */
const line = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s !== "" && s.length <= max && !CONTROL_IN_LINE.test(s) ? s : null;
};

/** A comment body: trimmed, non-empty, at most `MAX_COMMENT_BODY` characters, line breaks and tabs allowed. */
const body = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s !== "" && s.length <= MAX_COMMENT_BODY && !CONTROL_IN_BODY.test(s) ? s : null;
};

/** ISO 8601 date and time (`toISOString` form, or any date `Date` parses), or null. */
const stamp = (v: unknown): string | null =>
  typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v)) ? v : null;

const KEYS = new Set(["id", "author", "body", "created", "resolved", "replies"]);
const REPLY_KEYS = new Set(["author", "body", "created"]);

function replyProblem(v: unknown, where: string): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return `${where} must be an object with author, body and created`;
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r))
    if (!REPLY_KEYS.has(k)) return `${where} has an unknown key ${JSON.stringify(k)}`;
  if (line(r.author, MAX_COMMENT_AUTHOR) === null)
    return `${where} needs an author (one line, at most ${MAX_COMMENT_AUTHOR} characters)`;
  if (body(r.body) === null)
    return `${where} needs a body (at most ${MAX_COMMENT_BODY} characters)`;
  if (stamp(r.created) === null) return `${where} needs a created date and time`;
  return null;
}

function threadProblem(v: unknown, where: string): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return `${where} must be an object with id, author, body, created and replies`;
  const t = v as Record<string, unknown>;
  for (const k of Object.keys(t))
    if (!KEYS.has(k)) return `${where} has an unknown key ${JSON.stringify(k)}`;
  if (!isValidCommentId(t.id))
    return `${where} needs an id (a letter, then letters, digits, _ or -, at most 64 characters)`;
  if (line(t.author, MAX_COMMENT_AUTHOR) === null)
    return `${where} needs an author (one line, at most ${MAX_COMMENT_AUTHOR} characters)`;
  if (body(t.body) === null)
    return `${where} needs a body (at most ${MAX_COMMENT_BODY} characters)`;
  if (stamp(t.created) === null) return `${where} needs a created date and time`;
  if (typeof t.resolved !== "boolean") return `${where} needs resolved to be true or false`;
  if (!Array.isArray(t.replies))
    return `${where} needs replies (an array, empty when there are none)`;
  if (t.replies.length > MAX_COMMENT_REPLIES)
    return `${where} has ${t.replies.length} replies; the most one thread may hold is ${MAX_COMMENT_REPLIES}`;
  for (const [i, r] of t.replies.entries()) {
    const problem = replyProblem(r, `${where}, reply ${i + 1}`);
    if (problem) return problem;
  }
  return null;
}

/**
 * Why `value` is not a comments file, or null if it is one. Unknown keys, a duplicate thread id, a body that is empty
 * or too long, and a date that does not parse are all refused, so a hand-edited file cannot smuggle anything in.
 */
export function commentsProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "a comments file must be an object with a threads array";
  const f = value as Record<string, unknown>;
  for (const k of Object.keys(f))
    if (k !== "threads") return `comments have an unknown key ${JSON.stringify(k)}`;
  if (!Array.isArray(f.threads)) return "a comments file must have a threads array";
  if (f.threads.length > MAX_COMMENT_THREADS)
    return `${f.threads.length} threads on one page; the most it may hold is ${MAX_COMMENT_THREADS}`;
  const seen = new Set<string>();
  for (const [i, t] of f.threads.entries()) {
    const problem = threadProblem(t, `thread ${i + 1}`);
    if (problem) return problem;
    const id = (t as { id: string }).id;
    if (seen.has(id)) return `thread ${i + 1} repeats the id ${JSON.stringify(id)}`;
    seen.add(id);
  }
  return null;
}

/** A comments file as the app reads it: `{ threads: [] }` when the page has the file with no threads. */
export const emptyComments = (): CommentsFile => ({ threads: [] });

/** Runtime check for `commentsProblem`. */
export const isCommentsFile = (v: unknown): v is CommentsFile => commentsProblem(v) === null;

/** Throws with the problem unless `value` is a comments file. */
export function assertCommentsFile(value: unknown): asserts value is CommentsFile {
  const problem = commentsProblem(value);
  if (problem) throw new Error(`invalid comments file: ${problem}`);
}
