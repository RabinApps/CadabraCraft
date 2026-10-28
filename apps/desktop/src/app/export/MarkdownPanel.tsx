import { useLingui } from "@lingui/react/macro";
import { Checkbox } from "../../ui/Checkbox";

/** The Markdown format: whether underline and small caps are kept as HTML tags. */
export function MarkdownPanel({
  htmlMarks,
  onHtmlMarks,
  disabled,
}: {
  htmlMarks: boolean;
  onHtmlMarks: (on: boolean) => void;
  disabled: boolean;
}) {
  const { t } = useLingui();
  return (
    <Checkbox
      label={t`Keep underline and small caps`}
      hint={t`Markdown has no syntax for them, so they are written as HTML tags. Leave this off and the export stops at the first one, naming the chapter.`}
      checked={htmlMarks}
      disabled={disabled}
      onChange={(e) => onHtmlMarks(e.target.checked)}
    />
  );
}
