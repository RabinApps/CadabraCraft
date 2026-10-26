import { useEffect, useRef, useState } from "react";
import { buildEpub } from "@cadabracraft/export-epub";
import type { ChapterDoc } from "@cadabracraft/shared";
import { Editor } from "../editor/Editor";
import { loadChapter, saveBytes, saveChapter } from "../lib/bridge";

// M0 spike: a single hard-coded chapter location. Real project handling arrives in M1.
const CHAPTER_PATH = "spike/001-chapter-one.json";
const EPUB_PATH = "spike/chapter-one.epub";
const EMPTY: ChapterDoc = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter One" }] }, { type: "paragraph" }] };

export function App() {
  const [doc, setDoc] = useState<ChapterDoc | null>(null);
  const [status, setStatus] = useState("");
  const latest = useRef<ChapterDoc | null>(null);

  useEffect(() => {
    loadChapter(CHAPTER_PATH).then((d) => {
      latest.current = d ?? EMPTY;
      setDoc(d ?? EMPTY);
    });
  }, []);

  const save = async () => {
    if (!latest.current) return;
    await saveChapter(CHAPTER_PATH, latest.current);
    setStatus("Saved");
  };

  const exportEpub = async () => {
    if (!latest.current) return;
    await save();
    const bytes = buildEpub(
      { title: "Spike Book", author: "Author", language: "en", identifier: `urn:uuid:${crypto.randomUUID()}`, modified: new Date() },
      [{ id: "ch1", title: "Chapter One", doc: latest.current }],
    );
    await saveBytes(EPUB_PATH, Array.from(bytes));
    setStatus(`Exported ${EPUB_PATH}`);
  };

  if (!doc) return <p>Loading…</p>;
  return (
    <main style={{ maxWidth: 680, margin: "2rem auto", fontFamily: "serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={save}>Save</button>
        <button onClick={exportEpub}>Export EPUB</button>
        <span>{status}</span>
      </div>
      <Editor initial={doc} onChange={(d) => { latest.current = d; setStatus(""); }} />
    </main>
  );
}
