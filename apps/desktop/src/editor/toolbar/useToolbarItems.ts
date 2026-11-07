import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import {
  ALargeSmall,
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Superscript,
  Underline,
  Undo2,
} from "lucide-react";
import { normalizeLinkUrl } from "@cadabracraft/editor-schema";
import { focusField } from "../../ui/forms/Input";
import { attempt } from "../../state/attempt";
import { useRegisterCommands } from "../../state/app/commands";
import type { ToolbarItem } from "./types";
import type { ToolbarState } from "./useToolbarState";

type Chain = () => ReturnType<Editor["chain"]>;

/** State and actions of the Link dialog: the address typed, its error, and applying it to the selected text. */
export function useLinkDialog(editor: Editor, c: Chain, linked: boolean) {
  const { t } = useLingui();
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const setLink = () => {
    if (linked) {
      c().extendMarkRange("link").unsetLink().run();
      return;
    }
    setHref("");
    setLinkError("");
    setLinkOpen(true);
  };
  const applyLink = () => {
    const url = normalizeLinkUrl(href);
    if (!url) {
      setLinkError(t`That address can't be used as a link.`);
      focusField("link-address");
      return;
    }
    if (editor.state.selection.empty) {
      setLinkError(t`Select the text you want to link first.`);
      return;
    }
    setLinkOpen(false);
    c().extendMarkRange("link").setLink({ href: url }).run();
  };
  return { linkOpen, setLinkOpen, href, setHref, linkError, setLinkError, setLink, applyLink };
}

/** The buttons of the formatting bar, in their groups. */
export function useToolbarGroups(
  s: ToolbarState,
  c: Chain,
  actions: { setLink: () => void; addImage: () => Promise<void> },
): ToolbarItem[][] {
  const { t } = useLingui();
  return [
    [
      {
        id: "undo",
        label: t`Undo`,
        icon: Undo2,
        disabled: !s.canUndo,
        run: () => c().undo().run(),
      },
      {
        id: "redo",
        label: t`Redo`,
        icon: Redo2,
        disabled: !s.canRedo,
        run: () => c().redo().run(),
      },
    ],
    [
      { id: "bold", label: t`Bold`, icon: Bold, active: s.bold, run: () => c().toggleBold().run() },
      {
        id: "italic",
        label: t`Italic`,
        icon: Italic,
        active: s.italic,
        run: () => c().toggleItalic().run(),
      },
      {
        id: "underline",
        label: t`Underline`,
        icon: Underline,
        active: s.underline,
        run: () => c().toggleUnderline().run(),
      },
      {
        id: "smallCaps",
        label: t`Small caps`,
        icon: ALargeSmall,
        active: s.smallCaps,
        run: () => c().toggleMark("smallCaps").run(),
      },
      { id: "link", label: t`Link`, icon: Link, active: s.link, run: actions.setLink },
    ],
    [
      {
        id: "h1",
        label: t`Heading 1`,
        icon: Heading1,
        active: s.h1,
        run: () => c().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "h2",
        label: t`Heading 2`,
        icon: Heading2,
        active: s.h2,
        run: () => c().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "h3",
        label: t`Heading 3`,
        icon: Heading3,
        active: s.h3,
        run: () => c().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        id: "quote",
        label: t`Block quote`,
        icon: Quote,
        active: s.quote,
        run: () => c().toggleBlockquote().run(),
      },
      {
        id: "bullets",
        label: t`Bulleted list`,
        icon: List,
        active: s.bullets,
        run: () => c().toggleBulletList().run(),
      },
      {
        id: "numbers",
        label: t`Numbered list`,
        icon: ListOrdered,
        active: s.numbers,
        run: () => c().toggleOrderedList().run(),
      },
    ],
    [
      { id: "image", label: t`Image`, icon: ImageIcon, run: () => attempt(actions.addImage()) },
      {
        id: "footnote",
        label: t`Footnote`,
        icon: Superscript,
        run: () =>
          c()
            .insertContent({ type: "footnote", content: [{ type: "text", text: t`Note` }] })
            .run(),
      },
    ],
  ];
}

/** The same actions as menu commands (Insert and Format), available while the toolbar is shown. Undo and redo stay the system's. */
export function useRegisterToolbarCommands(
  barItems: ToolbarItem[],
  menuOnly: ToolbarItem[],
  alignItems: ToolbarItem[],
  alignNow: string,
) {
  useRegisterCommands(
    Object.fromEntries([
      ...[...barItems, ...menuOnly]
        .filter((b) => b.id !== "undo" && b.id !== "redo")
        .map((b) => [
          `editor.${b.id}`,
          {
            run: b.run,
            enabled: !b.disabled,
            ...(b.active === undefined ? {} : { checked: b.active }),
          },
        ]),
      ...alignItems.map((b) => [
        `editor.${b.id}`,
        { run: b.run, enabled: true, checked: b.id === alignNow },
      ]),
    ]),
  );
}
