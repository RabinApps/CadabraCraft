import { useLingui } from "@lingui/react/macro";
import type { Manifest } from "@cadabracraft/format";
import { cx } from "../../../ui/cx";
import { useLayout } from "../../../state/layout";
import { CommentsPanel } from "../../comments/CommentsPanel";
import { ReferencesPanel } from "../../references/ReferencesPanel";
import { SceneRail } from "../../scenes/SceneRail";
import { Details } from "../Details";

/** The panel at the right of the page: the open scene's notes, comments, references or the book's details. */
export function SidePanel({
  scene,
  manifest,
  pageTitle,
  section,
  words,
  viewingId,
  setViewingId,
  onChangeTemplate,
  onEditDetails,
}: {
  scene: boolean;
  manifest: Manifest;
  pageTitle: string | null;
  section: Parameters<typeof Details>[0]["section"];
  words: number;
  viewingId: string | null;
  setViewingId: (id: string | null) => void;
  onChangeTemplate: () => void;
  onEditDetails: () => void;
}) {
  const { t } = useLingui();
  const { references, comments, set: setLayout } = useLayout();
  return (
    <aside
      aria-label={
        scene ? t`Scene` : comments ? t`Comments` : references ? t`References` : t`Details`
      }
      className={cx(
        "hidden shrink-0 overflow-y-auto border-s border-border bg-surface xl:block",
        scene || references || comments ? "w-80" : "w-70",
      )}
    >
      {scene ? (
        <SceneRail />
      ) : comments ? (
        <CommentsPanel onClose={() => setLayout({ comments: false })} />
      ) : references ? (
        <ReferencesPanel openId={viewingId} onOpen={setViewingId} />
      ) : (
        <Details
          manifest={manifest}
          pageTitle={pageTitle}
          section={section}
          words={words}
          onChangeTemplate={onChangeTemplate}
          onEditDetails={onEditDetails}
          onOpenReference={setViewingId}
        />
      )}
    </aside>
  );
}
