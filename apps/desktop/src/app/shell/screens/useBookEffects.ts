import { useEffect } from "react";
import { chaptersOf, entryRows, sourceEdition } from "@cadabracraft/format";
import { bridge } from "../../../lib/bridge";
import { useProject } from "../../../state/project/index";
import { useRecents } from "../../../state/app/recents";
import { useUpdates } from "../../../state/app/updates";
import { attempt } from "../../../state/attempt";
import { libraryFields } from "../../library/libraryModel";
import { LG_QUERY } from "../breakpoints";

/** The background work of the open book: recents and Home stats, comments, the file watcher, the update check and the drawer. */
export function useBookEffects(bookWords: number | null, setDrawer: (open: boolean) => void) {
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const actions = useProject((s) => s.actions);
  const root = useProject((s) => s.root);
  const open = manifest !== null;
  const title = manifest ? sourceEdition(manifest.editions).title : undefined;
  const addRecent = useRecents((s) => s.add);
  const setStats = useRecents((s) => s.setStats);
  // Any successful open, create or import lands here.
  useEffect(() => {
    if (root && title !== undefined) addRecent(root, title);
  }, [root, title, addRecent]);
  // What the Home dashboard shows about this book, refreshed shortly after typing pauses.
  useEffect(() => {
    if (!root || !manifest || bookWords === null) return;
    const source = sourceEdition(manifest.editions);
    const rows = entryRows(chaptersOf(manifest), manifest.editions);
    const at = rows.findIndex((r) => r.id === currentId);
    const stats = {
      author: source.author,
      chapters: rows.length,
      words: bookWords,
      chapterNo: at + 1,
      chapterTitle: rows[at]?.title ?? "",
      ...libraryFields(source),
    };
    const id = setTimeout(() => setStats(root, stats), 1000);
    return () => clearTimeout(id);
  }, [root, manifest, currentId, bookWords, setStats]);
  // The rail shows one page's threads; they are read whenever the open page changes.
  useEffect(() => {
    if (open) void actions.loadComments(currentId);
  }, [open, currentId, actions]);
  useEffect(() => {
    if (!open) return;
    const un = bridge.onProjectChanged((p) => attempt(actions.externalChange(p)));
    const failed = bridge.onProjectWatchError(() => actions.watchFailed());
    return () => {
      void un.then((f) => f());
      void failed.then((f) => f());
    };
  }, [open, actions]);
  useEffect(() => {
    if (import.meta.env.PROD) void useUpdates.getState().check(false);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia(LG_QUERY);
    const close = () => mq.matches && setDrawer(false);
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, [setDrawer]);
}
