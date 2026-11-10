import { useLingui } from "@lingui/react/macro";
import { BookA, BookMarked } from "lucide-react";
import { IconButton } from "../../../ui/Button";
import { panelPatch, useLayout } from "../../../state/view/layout";
import { useIndexSheets } from "../../indexing/useIndexSheets";

/** The header buttons of the Index and Glossary panels: a rail from xl, a sheet below. */
export function IndexButtons() {
  const { t } = useLingui();
  const { index, glossary, set: setLayout } = useLayout();
  const setSheet = useIndexSheets((s) => s.set);
  return (
    <>
      <IconButton
        icon={BookA}
        label={t`Index`}
        active={index}
        className="max-xl:hidden"
        onClick={() => setLayout(panelPatch("index", !index))}
      />
      <IconButton
        icon={BookA}
        label={t`Index`}
        className="xl:hidden"
        onClick={() => setSheet({ index: true })}
      />
      <IconButton
        icon={BookMarked}
        label={t`Glossary`}
        active={glossary}
        className="max-xl:hidden"
        onClick={() => setLayout(panelPatch("glossary", !glossary))}
      />
      <IconButton
        icon={BookMarked}
        label={t`Glossary`}
        className="xl:hidden"
        onClick={() => setSheet({ glossary: true })}
      />
    </>
  );
}
