import { useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { Download, Menu, Save } from "lucide-react";
import { Editor } from "../editor/Editor";
import { bridge } from "../lib/bridge";
import { Badge } from "../ui/Badge";
import { Button, IconButton } from "../ui/Button";
import { overlayClass, panelClass } from "../ui/Dialog";
import { LanguagePicker } from "../ui/LanguagePicker";
import { ThemeToggle } from "../ui/ThemeToggle";
import { cx } from "../ui/cx";
import { Home } from "./Home";
import { Sidebar } from "./Sidebar";
import { useProject } from "./store";

export function App() {
  const { t } = useLingui();
  const { manifest, currentId, currentDoc, draft, notice, reloadCount, actions } = useProject();
  const open = manifest !== null;
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!open) return;
    const un = bridge.onProjectChanged((p) => void actions.externalChange(p));
    return () => void un.then((f) => f());
  }, [open, actions]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const close = () => { if (mq.matches) setDrawer(false); };
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);
  const [error, setError] = useState("");
  const run = (f: () => Promise<void>) => () => { setError(""); f().catch((e) => setError(String(e instanceof Error ? e.message : e))); };

  if (!manifest) {
    return (
      <Home
        error={error}
        pickFolder={bridge.pickFolder}
        onCreate={(root, title, author) => run(() => actions.createProject(root, title, author))()}
        onOpen={run(async () => { const root = await bridge.pickFolder(); if (root) await actions.openProject(root); })}
      />
    );
  }
  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-2 py-2 md:px-4">
        <IconButton icon={Menu} label={t`Show chapters`} className="lg:hidden" onClick={() => setDrawer(true)} />
        <h1 className="min-w-0 truncate font-book text-base font-semibold">{manifest.title}</h1>
        <Badge tone={draft ? "warn" : "success"}>{draft ? t`Unsaved` : t`Saved`}</Badge>
        <span role="status" className="min-w-0 flex-1 truncate text-sm text-ink-muted max-sm:order-last max-sm:basis-full max-sm:px-2 max-sm:empty:hidden">{notice}</span>
        <div className="ms-auto flex items-center gap-2">
          <LanguagePicker />
          <ThemeToggle />
          <Button icon={Save} className="max-sm:px-3" onClick={run(async () => { const d = useProject.getState().draft; if (d) await actions.saveCurrent(d); })}><span className="max-sm:sr-only">{t`Save`}</span></Button>
          <Button variant="primary" icon={Download} className="max-sm:px-3" onClick={run(actions.exportEpub)}><span className="max-sm:sr-only">{t`Export EPUB`}</span></Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[264px] shrink-0 overflow-y-auto bg-sidebar lg:block">
          <Sidebar />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          {error && <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="mx-auto max-w-[780px] md:p-8">
            <div className="prose-manuscript p-4 md:rounded-md md:border md:border-border md:bg-paper md:px-14 md:py-12">
              {currentDoc && currentId && <Editor key={`${currentId}:${reloadCount}`} initial={currentDoc} language={manifest.language} onChange={actions.setDraft} />}
            </div>
          </div>
        </main>
      </div>
      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className={cx(overlayClass, "lg:hidden")} />
          <D.Content
            aria-describedby={undefined}
            className={cx(panelClass, "inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-sidebar lg:hidden", "md:inset-y-0 md:start-0 md:end-auto md:max-h-none md:w-80 md:rounded-none")}
          >
            <D.Title className="sr-only">{t`Chapters`}</D.Title>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
    </div>
  );
}
