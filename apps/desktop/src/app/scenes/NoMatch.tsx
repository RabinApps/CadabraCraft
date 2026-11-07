import { useLingui } from "@lingui/react/macro";
import { SearchX } from "lucide-react";
import { Button } from "../../ui/Button";

/** What the board and the timeline show when the filter hides every scene. */
export function NoMatch({ onClear }: { onClear: () => void }) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col items-start gap-3 text-sm text-ink-muted">
      <SearchX size={24} aria-hidden />
      <p>{t`No scenes match these filters.`}</p>
      <Button onClick={onClear}>{t`Clear filters`}</Button>
    </div>
  );
}
