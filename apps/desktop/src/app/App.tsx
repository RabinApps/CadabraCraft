import { useEffect, useState } from "react";
import { Editor } from "../editor/Editor";
import { bridge } from "../lib/bridge";
import { Sidebar } from "./Sidebar";
import { useProject } from "./store";

export function App() {
  const { manifest, currentId, currentDoc, notice, reloadCount, actions } = useProject();
  const open = manifest !== null;
  useEffect(() => {
    if (!open) return;
    const un = bridge.onProjectChanged((p) => void actions.externalChange(p));
    return () => void un.then((f) => f());
  }, [open, actions]);
  const [error, setError] = useState("");
  const run = (f: () => Promise<void>) => () => { setError(""); f().catch((e) => setError(String(e instanceof Error ? e.message : e))); };

  const pick = (create: boolean) => run(async () => {
    const root = await bridge.pickFolder();
    if (!root) return;
    if (create) {
      const title = prompt("Book title?")?.trim();
      if (!title) return;
      await actions.createProject(root, title, prompt("Author?")?.trim() || "Unknown");
    } else await actions.openProject(root);
  });

  if (!manifest) {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "sans-serif" }}>
        <h1>CadabraCraft</h1>
        <button onClick={pick(true)}>New project…</button> <button onClick={pick(false)}>Open project…</button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }
  return (
    <div style={{ display: "flex", fontFamily: "serif" }}>
      <Sidebar />
      <main style={{ flex: 1, maxWidth: 680, margin: "2rem auto" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, fontFamily: "sans-serif" }}>
          <button onClick={run(async () => { const d = useProject.getState().draft; if (d) await actions.saveCurrent(d); })}>Save</button>
          <button onClick={run(actions.exportEpub)}>Export EPUB</button>
          <span role="status">{notice}</span>
        </div>
        {error && <p role="alert">{error}</p>}
        {currentDoc && currentId && <Editor key={`${currentId}:${reloadCount}`} initial={currentDoc} onChange={actions.setDraft} />}
      </main>
    </div>
  );
}
