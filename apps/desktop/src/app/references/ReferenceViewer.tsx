import { useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { useLingui } from "@lingui/react/macro";
import { ExternalLink, X } from "lucide-react";
import { bridge } from "../../lib/bridge";
import { formatSize, kindOf } from "../../lib/references/referenceKinds";
import { errText } from "../../lib/projectError";
import { useProject } from "../../state/project/index";
import { Button, IconButton } from "../../ui/Button";
import { keepFocusInView, overlayClass, panelClass } from "../../ui/Dialog";
import { Notice } from "../../ui/feedback/Notice";
import { ReferenceDetails } from "./ReferenceDetails";
import { Preview } from "./Previews";
import { kindIcon, useKindLabel } from "./ReferenceRow";
import { LinkView, NoteView, openLink } from "./TextReferenceViews";

/** The big viewer for one reference: the file on the left, its details on the right. */
export function ReferenceViewer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useLingui();
  const root = useProject((s) => s.root);
  const reference = useProject((s) => s.manifest?.references.find((r) => r.id === id));
  const label = useKindLabel();
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState("");
  const file = reference?.kind === "file" ? reference.file : undefined;
  useEffect(() => {
    setSize(null);
    setError("");
    if (!file) return;
    let alive = true;
    bridge.statReference(root!, file).then(
      (s) => alive && setSize(s.size),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [root, file]);
  if (!reference || !root) return null;
  const kind = kindOf(reference);
  const Icon = kindIcon(kind);
  const meta = [label(kind), size === null ? "" : formatSize(size)].filter(Boolean).join(" · ");
  return (
    <D.Root open onOpenChange={(open) => !open && onClose()}>
      <D.Portal>
        <D.Overlay className={overlayClass} />
        <D.Content
          aria-describedby={undefined}
          // Radix moves focus with preventScroll when Tab wraps, so without this a focused control can stay out of view (WCAG 2.4.11).
          onFocus={keepFocusInView}
          className={`${panelClass} left-1/2 top-1/2 flex h-[min(92dvh,720px)] w-[min(96vw,1120px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg`}
        >
          <header className="flex items-center gap-3 border-b border-border px-5 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <Icon size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <D.Title className="truncate text-lead font-semibold">{reference.title}</D.Title>
              <p className="truncate text-xs text-ink-muted">{meta}</p>
            </div>
            {reference.kind === "file" && kind !== "text" && !reference.file.endsWith(".svg") && (
              <Button
                size="sm"
                icon={ExternalLink}
                onClick={() => {
                  setError("");
                  bridge.openReference(root, reference.file).catch((e) => setError(errText(e)));
                }}
              >{t`Open in default app`}</Button>
            )}
            {reference.kind === "link" && (
              <Button
                size="sm"
                icon={ExternalLink}
                onClick={() => {
                  setError("");
                  openLink(reference.url, setError);
                }}
              >{t`Open in browser`}</Button>
            )}
            <D.Close asChild>
              <IconButton icon={X} label={t`Close viewer`} />
            </D.Close>
          </header>
          {error && (
            <Notice role="alert" className="m-3">
              {error}
            </Notice>
          )}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="flex min-h-64 min-w-0 flex-1 flex-col">
              {reference.kind === "file" && kind !== "link" && kind !== "note" ? (
                <Preview
                  key={reference.id}
                  root={root}
                  file={reference.file}
                  title={reference.title}
                  kind={kind}
                />
              ) : reference.kind === "link" ? (
                <LinkView key={reference.id} reference={reference} />
              ) : reference.kind === "note" ? (
                <NoteView key={reference.id} reference={reference} />
              ) : null}
            </div>
            <aside
              aria-label={t`Reference details`}
              className="max-h-[45%] w-full shrink-0 overflow-y-auto border-t border-border md:max-h-none md:w-75 md:border-s md:border-t-0"
            >
              <ReferenceDetails key={reference.id} reference={reference} onRemoved={onClose} />
            </aside>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
