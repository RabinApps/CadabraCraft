import { t } from "@lingui/core/macro";
import { useProject } from "../../state/project/index";
import { IndexMarkers } from "./markers";

/**
 * The tooltip extension with the app's words and the open book's glossary. The words are read when the tooltip is drawn, so a change
 * of language shows at the next redraw.
 */
export const appIndexMarkers = () =>
  IndexMarkers(
    () => new Map((useProject.getState().manifest?.glossary?.entries ?? []).map((e) => [e.id, e])),
    {
      index: (term, sub, see, seeAlso) =>
        [
          t`Index: ${sub ? `${term}, ${sub}` : term}`,
          ...(see ? [t`See ${see}`] : []),
          ...(seeAlso ? [t`See also ${seeAlso}`] : []),
        ].join(". "),
      glossary: (entry) =>
        entry
          ? entry.definition
            ? t`Glossary: ${entry.term}. ${entry.definition}`
            : t`Glossary: ${entry.term} (no definition yet)`
          : t`Glossary term that is not in the glossary any more`,
    },
  );
