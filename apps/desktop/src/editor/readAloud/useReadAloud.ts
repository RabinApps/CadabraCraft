import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { bridge } from "../../lib/bridge";
import { AUDIO_SPEEDS } from "../../lib/audio/audioFormats";
import { describeAudioError } from "../../lib/audio/audioErrors";
import { mapAudioError } from "../../lib/audio/audioRunner";
import { useSettings } from "../../state/view/editorPrefs";
import { indexAtCursor, pause, resume, start, STOPPED, type ReadState } from "./machine";
import { startPlayback, type Playback } from "./playback";
import { readSentences, type ReadSentence } from "./sentenceList";
import { setHighlight } from "./highlight";
import { chooseReadingVoice } from "./voice";

/** What the status line says. `message` is set for errors only. */
export type ReadLine =
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "paused" }
  | { kind: "stopped" }
  | { kind: "edited" }
  | { kind: "done" }
  | { kind: "empty" }
  | { kind: "cursor" }
  | { kind: "novoice" }
  | { kind: "error"; message: string };

interface Run {
  playback: Playback;
  sentences: readonly ReadSentence[];
  jobId: string;
}

export interface ReadAloud {
  state: ReadState;
  line: ReadLine;
  speed: number;
  /** Starts from the top of the chapter, pauses while reading, resumes while paused. */
  play: () => void;
  stop: () => void;
  readFromCursor: () => void;
  setSpeed: (speed: number) => void;
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Keeps the highlighted sentence in view without moving focus; instant when the author asks for reduced motion. */
function revealHighlight() {
  requestAnimationFrame(() =>
    document
      .querySelector(".read-aloud-current")
      ?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }),
  );
}

/**
 * Read aloud for the open chapter: plays the sentences with the book's local voice, highlights the one being read and stops
 * when the text changes. The clips come from the same engine call as "Hear a sample". Nothing is written to the project.
 */
export function useReadAloud(editor: Editor | null, language: string): ReadAloud {
  const [state, setState] = useState<ReadState>(STOPPED);
  const [line, setLine] = useState<ReadLine>({ kind: "none" });
  const [speed, setSpeedValue] = useState<number>(AUDIO_SPEEDS[1]);
  const run = useRef<Run | null>(null);
  /** Bumped by every start and stop, so a start that is still choosing a voice gives up when stopped. */
  const token = useRef(0);
  const speedRef = useRef(speed);

  /** Ends the run, frees the engine job and clears the highlight. Says nothing on its own: callers set the status line. */
  const teardown = useCallback(() => {
    token.current++;
    const r = run.current;
    run.current = null;
    if (r) {
      r.playback.stop();
      bridge.audioCancel(r.jobId).catch(() => undefined);
      bridge.audioForget(r.jobId).catch(() => undefined);
    }
    if (editor && !editor.isDestroyed) setHighlight(editor, null);
    setState(STOPPED);
  }, [editor]);

  const stopWith = useCallback(
    (next: ReadLine) => {
      const was = run.current !== null;
      teardown();
      if (was) setLine(next);
    },
    [teardown],
  );

  /** Starts reading the chapter from sentence `index` of a fresh sentence list. */
  const begin = useCallback(
    async (index: number) => {
      if (!editor) return;
      const sentences = readSentences(editor.state.doc);
      if (sentences.length === 0) return setLine({ kind: "empty" });
      if (index < 0) return setLine({ kind: "cursor" });
      teardown();
      const mine = token.current;
      const voice = await chooseReadingVoice(language, useSettings.getState().audioVoice).catch(
        (e: unknown) => {
          setLine({ kind: "error", message: describeAudioError(mapAudioError(e)).message });
          return null;
        },
      );
      if (voice === null || mine !== token.current) return;
      if (!voice) return setLine({ kind: "novoice" });
      const jobId = crypto.randomUUID();
      const rate = speedRef.current;
      const playback = startPlayback(sentences, index, {
        synthesize: (req) =>
          bridge.audioSample({
            jobId,
            chunks: [req],
            voice,
            speed: rate,
          }),
        onSentence: (i) => {
          setState((s) => ({ ...s, index: i }));
          setHighlight(editor, { from: sentences[i]!.from, to: sentences[i]!.to });
          revealHighlight();
        },
        onEnd: () => {
          stopWith({ kind: "done" });
        },
        onError: (e) => {
          stopWith({ kind: "error", message: describeAudioError(mapAudioError(e)).message });
        },
      });
      run.current = { playback, sentences, jobId };
      setState(start(sentences.length, index));
      setLine({ kind: "reading" });
    },
    [editor, language, stopWith, teardown],
  );

  const play = useCallback(() => {
    if (!run.current) return void begin(0);
    const next = state.status === "reading" ? pause(state) : resume(state);
    if (next.status === "paused") {
      run.current.playback.pause();
      setLine({ kind: "paused" });
    } else {
      run.current.playback.resume();
      setLine({ kind: "reading" });
    }
    setState(next);
  }, [begin, state]);

  const stop = useCallback(() => stopWith({ kind: "stopped" }), [stopWith]);

  const readFromCursor = useCallback(() => {
    if (!editor) return;
    const sentences = readSentences(editor.state.doc);
    void begin(indexAtCursor(sentences, editor.state.selection.from));
  }, [begin, editor]);

  const setSpeed = useCallback(
    (next: number) => {
      speedRef.current = next;
      setSpeedValue(next);
      // A new speed is heard from the sentence being read on: the clips already made keep their old speed.
      if (run.current) void begin(Math.max(0, state.index));
    },
    [begin, state.index],
  );

  // Stop on any edit: the text being read may no longer be the text on the page.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => stopWith({ kind: "edited" });
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      teardown();
    };
  }, [editor, stopWith, teardown]);

  return { state, line, speed, play, stop, readFromCursor, setSpeed };
}
