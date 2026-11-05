import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import {
  Asterisk,
  Code,
  Code2,
  Languages,
  List,
  ListTodo,
  SeparatorHorizontal,
  SquarePen,
  Strikethrough,
  Subscript,
  Superscript,
} from "lucide-react";
import type { ToolbarItem } from "./types";
import type { ToolbarState } from "./useToolbarState";
import { insertDefinitionList } from "../insertDefinitionList";

/** The less common marks and blocks that sit in the More formatting menu at the end of the bar (and in the Format and Insert menus). */
export function useMenuOnlyItems(
  editor: Editor,
  s: ToolbarState,
  c: () => ReturnType<Editor["chain"]>,
  lang: { openLang: () => void; clearLang: () => void },
  editImage: () => void,
): ToolbarItem[] {
  const { t } = useLingui();
  return [
    {
      id: "imageDetails",
      label: t`Image details`,
      icon: SquarePen,
      disabled: !s.image,
      run: editImage,
    },
    {
      // Off the bar like Image details: the alignment button is the eighteenth one it could not hold (see docs/architecture.md,
      // "Toolbar overflow menu"). It stays in the Format menu and on the palette.
      id: "sceneBreak",
      label: t`Scene break`,
      icon: Asterisk,
      run: () =>
        c()
          .insertContent([{ type: "sceneBreak" }, { type: "paragraph" }])
          .run(),
    },
    {
      // Prints nothing of its own: the block after it starts on a new page, so two in a row leave an empty page.
      id: "pageBreak",
      label: t`Page break`,
      icon: SeparatorHorizontal,
      run: () =>
        c()
          .insertContent([{ type: "pageBreak" }])
          .run(),
    },
    {
      id: "taskList",
      label: t`Task list`,
      icon: ListTodo,
      active: s.taskList,
      run: () =>
        s.taskList
          ? c().liftListItem("taskItem").run()
          : c().toggleList("taskList", "taskItem").run(),
    },
    {
      id: "definitionList",
      label: t`Definition list`,
      icon: List,
      active: s.definitionList,
      run: () => insertDefinitionList(editor),
    },
    {
      id: "strike",
      label: t`Strikethrough`,
      icon: Strikethrough,
      active: s.strike,
      run: () => c().toggleStrike().run(),
    },
    {
      id: "code",
      label: t`Code`,
      icon: Code,
      active: s.code,
      run: () => c().toggleCode().run(),
    },
    {
      id: "superscript",
      label: t`Superscript`,
      icon: Superscript,
      active: s.superscript,
      run: () => c().toggleMark("superscript").run(),
    },
    {
      id: "subscript",
      label: t`Subscript`,
      icon: Subscript,
      active: s.subscript,
      run: () => c().toggleMark("subscript").run(),
    },
    {
      id: "lang",
      label: t`Language of selection…`,
      icon: Languages,
      active: s.lang,
      run: lang.openLang,
    },
    {
      id: "clearLang",
      label: t`Clear language`,
      icon: Languages,
      disabled: !s.lang,
      run: lang.clearLang,
    },
    {
      id: "codeBlock",
      label: t`Code Block`,
      icon: Code2,
      active: s.codeBlock,
      run: () => c().toggleCodeBlock().run(),
    },
  ];
}
