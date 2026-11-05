import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Task lists: a list whose items each carry a `checked` flag (a checkbox). An item holds a paragraph first, then any blocks,
 * like a list item, so task lists can nest (and hold ordinary lists). The HTML form is `ul[data-type=taskList]` with
 * `li[data-type=taskItem][data-checked]` so pasting it back keeps the state; the editor swaps the static checkbox for a live one.
 */
export const TaskList = Node.create({
  name: "taskList",
  group: "block",
  content: "taskItem+",
  parseHTML: () => [{ tag: 'ul[data-type="taskList"]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => [
    "ul",
    mergeAttributes(HTMLAttributes, { "data-type": "taskList" }),
    0,
  ],
});

export const TaskItem = Node.create({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,
  addAttributes: () => ({
    checked: {
      default: false,
      keepOnSplit: false,
      parseHTML: (el) => el.getAttribute("data-checked") === "true",
      renderHTML: (attrs) => ({ "data-checked": attrs.checked ? "true" : "false" }),
    },
  }),
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem("taskItem"),
      Tab: () => this.editor.commands.sinkListItem("taskItem"),
      "Shift-Tab": () => this.editor.commands.liftListItem("taskItem"),
    };
  },
  parseHTML: () => [
    {
      tag: 'li[data-type="taskItem"]',
      priority: 60,
      contentElement: (el) =>
        (el as HTMLElement).querySelector(":scope > div") ?? (el as HTMLElement),
    },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    "li",
    mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }),
    [
      "label",
      { contenteditable: "false" },
      [
        "input",
        {
          type: "checkbox",
          disabled: "disabled",
          ...(node.attrs.checked ? { checked: "checked" } : {}),
        },
      ],
    ],
    ["div", 0],
  ],
});

/**
 * Definition lists: a term (inline text) followed by one or more descriptions (a paragraph, then any blocks). Several terms may
 * share the descriptions that follow them. Maps to `dl` / `dt` / `dd`.
 */
export const DefinitionList = Node.create({
  name: "definitionList",
  group: "block",
  content: "(definitionTerm+ definitionDescription+)+",
  parseHTML: () => [{ tag: "dl" }],
  renderHTML: ({ HTMLAttributes }) => ["dl", HTMLAttributes, 0],
});

export const DefinitionTerm = Node.create({
  name: "definitionTerm",
  content: "inline*",
  defining: true,
  addKeyboardShortcuts() {
    return {
      // Enter in a term goes on to what follows it (its description, or the next term), the way Enter ends a line of a list: splitting
      // a term would only make another term, and there would be no way to reach the description from the keyboard.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== this.name) return false;
        const after = $from.after();
        const next = editor.state.doc.resolve(after).nodeAfter;
        if (!next) return false;
        // Inside a description the caret goes into its first paragraph (one level deeper).
        return editor.commands.setTextSelection(
          next.type.name === "definitionDescription" ? after + 2 : after + 1,
        );
      },
    };
  },
  parseHTML: () => [{ tag: "dt" }],
  renderHTML: ({ HTMLAttributes }) => ["dt", HTMLAttributes, 0],
});

export const DefinitionDescription = Node.create({
  name: "definitionDescription",
  content: "paragraph block*",
  defining: true,
  parseHTML: () => [{ tag: "dd" }],
  renderHTML: ({ HTMLAttributes }) => ["dd", HTMLAttributes, 0],
});
