import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { AlignCenter, AlignLeft, AlignRight, Pilcrow } from "lucide-react";
import type { AlignItem } from "./AlignmentMenu";
import type { ToolbarState } from "./useToolbarState";

/** Text alignment: the blocks the author aligned say how (start, centre, end); the rest follow the template. */
export function useAlignItems(
  s: ToolbarState,
  c: () => ReturnType<Editor["chain"]>,
): { alignNow: AlignItem["id"]; alignItems: AlignItem[] } {
  const { t } = useLingui();
  const alignNow: AlignItem["id"] =
    s.align === "start"
      ? "alignLeft"
      : s.align === "center"
        ? "alignCenter"
        : s.align === "end"
          ? "alignRight"
          : "alignDefault";
  const alignItems: AlignItem[] = [
    {
      id: "alignLeft",
      label: t`Align to Start`,
      icon: AlignLeft,
      combo: null,
      run: () => c().setTextAlign("start").run(),
    },
    {
      id: "alignCenter",
      label: t`Centre`,
      icon: AlignCenter,
      combo: null,
      run: () => c().setTextAlign("center").run(),
    },
    {
      id: "alignRight",
      label: t`Align to End`,
      icon: AlignRight,
      combo: null,
      run: () => c().setTextAlign("end").run(),
    },
    {
      id: "alignDefault",
      label: t`Template Default`,
      icon: Pilcrow,
      combo: null,
      run: () => c().setTextAlign(null).run(),
    },
  ];
  return { alignNow, alignItems };
}
