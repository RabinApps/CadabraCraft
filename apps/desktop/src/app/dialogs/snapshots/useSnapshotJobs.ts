import { useState } from "react";
import { causeText } from "../../../lib/projectError";
import type { ErrorAbout } from "./SnapshotControls";
import type { PruneNotice } from "./snapshotText";

/** The busy flag, the message and the notice of the Book snapshots panel, and `run`, which settles one action at a time. */
export function useSnapshotJobs() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** What the message is about: the name field (refused), the Take button (failed) or another action. */
  const [errorAbout, setErrorAbout] = useState<ErrorAbout>("other");
  const [notice, setNotice] = useState<PruneNotice | null>(null);
  const fail = (about: ErrorAbout, message: string) => {
    setErrorAbout(about);
    setError(message);
  };
  /** Runs one action: the buttons stay off until it settles, and a failure is shown. */
  const run = async (
    job: () => Promise<void>,
    failure: (reason: string) => string,
    about: "take" | "other" = "other",
  ) => {
    setBusy(true);
    setError("");
    setNotice(null);
    try {
      await job();
    } catch (e) {
      fail(about, failure(causeText(e)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, errorAbout, notice, setNotice, setError, fail, run };
}
