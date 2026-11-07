import { useEffect, useState, type ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { File } from "lucide-react";
import type { FileKind } from "../../lib/references/referenceKinds";
import { errText } from "../../lib/projectError";
import { readReferenceBytes, referenceUrl } from "../../lib/references/references";
import { Notice } from "../../ui/feedback/Notice";
import { ImagePreview } from "./ImagePreview";
import { PdfPreview } from "./PdfPreview";

interface Props {
  root: string;
  file: string;
  title: string;
  kind: FileKind;
}

/** Loads a value once per file (the viewer is remounted for each reference) and keeps a failure's message. */
function useLoaded<T>(load: () => Promise<T>): { value: T | null; error: string } {
  const [state, setState] = useState<{ value: T | null; error: string }>({
    value: null,
    error: "",
  });
  useEffect(() => {
    load().then(
      (value) => setState({ value, error: "" }),
      (e) => setState({ value: null, error: errText(e) }),
    );
    // The component is keyed by the reference, so the file it reads never changes while it is mounted.
  }, []);
  return state;
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-sidebar p-4">
      {children}
    </div>
  );
}

function Media({ root, file, title, kind }: Props) {
  const { t } = useLingui();
  const { value: url, error } = useLoaded(() => referenceUrl(root, file));
  if (error)
    return <Notice role="alert" className="m-4">{t`Could not open ${title}: ${error}`}</Notice>;
  if (!url)
    return (
      <Stage>
        <p className="text-sm text-ink-muted" role="status">{t`Loading…`}</p>
      </Stage>
    );
  if (kind === "image") return <ImagePreview url={url} title={title} />;
  if (kind === "video")
    return (
      <div className="flex min-h-0 flex-1 bg-black">
        <video src={url} controls aria-label={title} className="size-full" />
      </div>
    );
  return (
    <Stage>
      <audio src={url} controls aria-label={title} className="w-full max-w-md" />
    </Stage>
  );
}

function TextPreview({ root, file, title }: Props) {
  const { t } = useLingui();
  const { value, error } = useLoaded(async () =>
    new TextDecoder().decode(await readReferenceBytes(root, file)),
  );
  if (error)
    return <Notice role="alert" className="m-4">{t`Could not open ${title}: ${error}`}</Notice>;
  return (
    <pre
      className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-paper p-5 font-book text-reading text-ink"
      aria-label={title}
    >
      {value ?? t`Loading…`}
    </pre>
  );
}

/** The part of the viewer that shows the file itself, chosen by what it is. */
export function Preview(props: Props) {
  const { t } = useLingui();
  switch (props.kind) {
    case "pdf":
      return <PdfPreview root={props.root} file={props.file} />;
    case "text":
      return <TextPreview {...props} />;
    case "image":
    case "video":
    case "audio":
      return <Media {...props} />;
    default:
      return (
        <Stage>
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-accent">
              <File size={28} aria-hidden />
            </span>
            <p className="text-lead font-semibold">{t`No preview for this file type`}</p>
            <p className="text-sm text-ink-muted">{t`It is stored with your book. Open it in another app to read it.`}</p>
          </div>
        </Stage>
      );
  }
}
