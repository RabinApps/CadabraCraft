import { beforeEach, describe, expect, it } from "vitest";
import { useSettings } from "../../../../state/view/editorPrefs";
import { raiseEpubCheck, useEpubCheckSignal } from "../../epubcheck/epubAutoCheck";

beforeEach(() => useEpubCheckSignal.setState({ signal: 0 }));

describe("raiseEpubCheck", () => {
  it("does nothing while the check after export is off", () => {
    useSettings.setState({ validateEpub: false });
    expect(raiseEpubCheck()).toBe(false);
    expect(useEpubCheckSignal.getState().signal).toBe(0);
  });
  it("raises the signal each time while it is on", () => {
    useSettings.setState({ validateEpub: true });
    expect(raiseEpubCheck()).toBe(true);
    expect(raiseEpubCheck()).toBe(true);
    expect(useEpubCheckSignal.getState().signal).toBe(2);
    useSettings.setState({ validateEpub: false });
  });
});
