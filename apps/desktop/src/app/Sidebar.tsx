import { useState } from "react";
import { useProject } from "./store";

export function Sidebar() {
  const { manifest, currentId, actions } = useProject();
  const [editing, setEditing] = useState<string | null>(null);
  if (!manifest) return null;
  const last = manifest.chapters.length - 1;
  return (
    <nav aria-label="Chapters" style={{ width: 240, padding: 12, borderRight: "1px solid #ddd" }}>
      <h2 style={{ fontSize: 14 }}>{manifest.title}</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {manifest.chapters.map((c, i) => (
          <li key={c.id} style={{ display: "flex", gap: 4, alignItems: "center", fontWeight: c.id === currentId ? 700 : 400 }}>
            {editing === c.id ? (
              <input
                autoFocus
                aria-label="Chapter title"
                defaultValue={c.title}
                onBlur={(e) => { setEditing(null); if (e.target.value.trim() && e.target.value !== c.title) void actions.rename(c.id, e.target.value.trim()); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(null); }}
              />
            ) : (
              <button style={{ flex: 1, textAlign: "left", background: "none", border: 0, font: "inherit", cursor: "pointer" }} aria-current={c.id === currentId} onClick={() => void actions.selectChapter(c.id)}>
                {c.title}
              </button>
            )}
            <button aria-label={`Rename ${c.title}`} onClick={() => setEditing(c.id)}>✎</button>
            <button aria-label={`Move ${c.title} up`} disabled={i === 0} onClick={() => void actions.move(c.id, -1)}>↑</button>
            <button aria-label={`Move ${c.title} down`} disabled={i === last} onClick={() => void actions.move(c.id, 1)}>↓</button>
            <button aria-label={`Delete ${c.title}`} onClick={() => { if (confirm(`Move "${c.title}" to the project trash?`)) void actions.remove(c.id); }}>✕</button>
          </li>
        ))}
      </ul>
      <button onClick={() => void actions.add(`Chapter ${manifest.chapters.length + 1}`)}>+ Add chapter</button>
    </nav>
  );
}
