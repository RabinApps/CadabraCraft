import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "@tiptap/pm/state";
import { TabKey } from "../tabKey";

interface EditorLike {
  isActive: (name: string) => boolean;
  commands: { insertContent: (value: string) => void };
}

/** The extension's one plugin, built against a fake editor (the real one needs a mounted view). */
function tabPlugin(editor: EditorLike): Plugin {
  const build = TabKey.config.addProseMirrorPlugins as unknown as (this: {
    editor: EditorLike;
  }) => Plugin[];
  return build.call({ editor })[0]!;
}

const keyEvent = (init: Partial<KeyboardEvent> = {}) =>
  ({
    key: "Tab",
    keyCode: 0,
    isComposing: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...init,
  }) as unknown as KeyboardEvent;

const view = (empty = true) => ({ state: { selection: { empty } } }) as never;

function harness(active: string[] = [], empty = true) {
  const insertContent = vi.fn();
  const plugin = tabPlugin({
    isActive: (name) => active.includes(name),
    commands: { insertContent },
  });
  const press = (init?: Partial<KeyboardEvent>) => {
    const e = keyEvent(init);
    const handled = plugin.props.handleKeyDown!.call(plugin, view(empty), e);
    return { e, handled };
  };
  const blur = () => plugin.props.handleDOMEvents!.blur!.call(plugin, view(), {} as never);
  return { insertContent, press, blur };
}

describe("TabKey", () => {
  it("types a tab character instead of leaving the editor", () => {
    const { insertContent, press } = harness();
    const { e, handled } = press();
    expect(handled).toBe(true);
    expect(insertContent).toHaveBeenCalledWith("\t");
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("leaves other keys alone", () => {
    const { insertContent, press } = harness();
    const { e, handled } = press({ key: "Enter" });
    expect(handled).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(insertContent).not.toHaveBeenCalled();
  });

  it("lets Escape then Tab leave, and only that one Tab", () => {
    const { insertContent, press } = harness();
    expect(press({ key: "Escape" }).handled).toBe(false);
    expect(press().handled).toBe(false);
    // The next Tab is the editor's again.
    expect(press().handled).toBe(true);
    expect(insertContent).toHaveBeenCalledTimes(1);
  });

  it("forgets a pending Escape when another key comes first", () => {
    const { press } = harness();
    press({ key: "Escape" });
    press({ key: "a" });
    expect(press().handled).toBe(true);
  });

  it("forgets a pending Escape when the editor loses the focus", () => {
    const { press, blur } = harness();
    press({ key: "Escape" });
    blur();
    expect(press().handled).toBe(true);
  });

  it("leaves a modified Tab (Shift, Alt, Ctrl, Meta) to the app", () => {
    for (const modifier of ["shiftKey", "altKey", "ctrlKey", "metaKey"] as const) {
      const { insertContent, press } = harness();
      const { e, handled } = press({ [modifier]: true } as Partial<KeyboardEvent>);
      expect(handled).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(insertContent).not.toHaveBeenCalled();
    }
  });

  it("keeps a Tab the list or table keys could not use, rather than drop the focus", () => {
    for (const block of ["bulletList", "orderedList", "taskList", "table"]) {
      const { insertContent, press } = harness([block]);
      const { e, handled } = press();
      expect(handled).toBe(true);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(insertContent).not.toHaveBeenCalled();
    }
  });

  it("does nothing over a selection instead of replacing the text", () => {
    const { insertContent, press } = harness([], false);
    const { e, handled } = press();
    expect(handled).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(insertContent).not.toHaveBeenCalled();
  });

  it("leaves a key that belongs to an input method (composition) to it", () => {
    const { insertContent, press } = harness();
    expect(press({ isComposing: true }).handled).toBe(false);
    expect(press({ keyCode: 229, key: "Process" }).handled).toBe(false);
    expect(insertContent).not.toHaveBeenCalled();
  });

  it("sits after the list and table key maps", () => {
    expect(TabKey.config.priority).toBe(50);
  });
});
