import { describe, expect, it } from "vitest";
import { useAnalysis } from "../analysis";
import { useReadAloudRequest } from "../readAloudRequest";
import { useWritingDialog } from "../writingDialog";

describe("File menu dialogs", () => {
  it.each([
    ["analysis", useAnalysis],
    ["writing history", useWritingDialog],
  ])("%s opens and closes", (_name, store) => {
    expect(store.getState().open).toBe(false);
    store.getState().show();
    expect(store.getState().open).toBe(true);
    store.getState().close();
    expect(store.getState().open).toBe(false);
  });
});

describe("Read Aloud from Cursor", () => {
  it("counts each request", () => {
    const before = useReadAloudRequest.getState().count;
    useReadAloudRequest.getState().request();
    useReadAloudRequest.getState().request();
    expect(useReadAloudRequest.getState().count).toBe(before + 2);
  });
});
