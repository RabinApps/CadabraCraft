import { useCallback, useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { bridge, type VoicePack } from "../../lib/bridge";
import { describeAudioError } from "../../lib/audioErrors";
import type { VoiceInfo } from "@cadabracraft/export-audio";
import { AUDIO_FORMATS, mb, toggleAudioFormat } from "../../lib/audioFormats";
import { useAudioLabels } from "../hooks/useAudioLabels";
import { Select } from "../../ui/Select";
import type { AudioFormat } from "@cadabracraft/export-audio";
import { Section, Row } from "./SettingsParts";

/** Audiobook preferences: the voice and formats the export starts with, and the downloaded voices with a way to remove them. */
export function AudioSection({
  title,
  voice,
  formats,
  onVoice,
  onFormats,
}: {
  title: string;
  voice: string;
  formats: AudioFormat[];
  onVoice: (id: string) => void;
  onFormats: (f: AudioFormat[]) => void;
}) {
  const { t } = useLingui();
  const names = useAudioLabels();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [packs, setPacks] = useState<VoicePack[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState("");
  // Element id to focus after the next render: the controls swap in place, so focus would otherwise be dropped on the page.
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId.current) return;
    document.getElementById(focusId.current)?.focus();
    focusId.current = null;
  }, [confirm, done]);
  const refresh = useCallback(async (live: () => boolean = () => true) => {
    try {
      const [v, p] = await Promise.all([bridge.audioVoices(), bridge.audioPacks()]);
      if (live()) {
        setVoices(v);
        setPacks(p);
      }
    } catch (e) {
      if (live()) setError(describeAudioError(e).message);
    }
  }, []);
  useEffect(() => {
    let live = true;
    void refresh(() => live);
    return () => {
      live = false;
    };
  }, [refresh]);
  const packName = (p: VoicePack) =>
    p.id === "piper" ? t`Piper voices: Amy and LibriTTS` : t`Kokoro: Heart`;
  const cancel = (id: string) => {
    focusId.current = `audio-delete-${id}`;
    setConfirm(null);
  };
  const remove = async (p: VoicePack) => {
    focusId.current = "audio-delete-result";
    setConfirm(null);
    setError(null);
    setDone("");
    try {
      await bridge.audioDeletePack(p.id);
      setDone(t`${packName(p)} deleted from this computer.`);
    } catch (e) {
      setError(describeAudioError(e).message);
    }
    await refresh();
  };
  const installed = voices.filter((v) => v.installed);
  return (
    <Section id="audio" title={title}>
      <Row
        title={t`Default voice`}
        hint={t`The voice the audiobook export starts with. Only installed voices can be picked.`}
        control={
          <div className="w-56 max-sm:w-full">
            <Select
              label={t`Default voice`}
              hideLabel
              className="py-2"
              value={installed.some((v) => v.id === voice) ? voice : ""}
              onChange={(e) => onVoice(e.target.value)}
            >
              <option value="">{t`Best installed voice`}</option>
              {installed.map((v) => (
                <option key={v.id} value={v.id}>
                  {names.voice(v.id)}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      <Row
        title={t`Default formats`}
        hint={t`The audio formats ticked when you open the export.`}
        control={
          <fieldset className="flex gap-4">
            <legend className="sr-only">{t`Default formats`}</legend>
            {AUDIO_FORMATS.map((f) => (
              <Checkbox
                key={f}
                label={names.format(f).label}
                checked={formats.includes(f)}
                onChange={(e) => {
                  const next = toggleAudioFormat(formats, f, e.target.checked);
                  if (next) onFormats(next);
                }}
              />
            ))}
          </fieldset>
        }
      />
      {packs.map((p) => (
        <Row
          key={p.id}
          title={packName(p)}
          hint={
            p.installed
              ? t`Installed, about ${mb(p.bytes)} MB on this computer.`
              : t`Not installed. Download it from the Audiobook export.`
          }
          control={
            p.installed ? (
              confirm === p.id ? (
                <div
                  role="group"
                  aria-label={t`Delete ${packName(p)} from this computer?`}
                  className="flex gap-2"
                >
                  <Button
                    id={`audio-keep-${p.id}`}
                    onKeyDown={(e) => e.key === "Escape" && cancel(p.id)}
                    onClick={() => cancel(p.id)}
                  >{t`Keep`}</Button>
                  <Button
                    variant="danger"
                    onKeyDown={(e) => e.key === "Escape" && cancel(p.id)}
                    onClick={() => void remove(p)}
                  >{t`Delete voices`}</Button>
                </div>
              ) : (
                <Button
                  id={`audio-delete-${p.id}`}
                  onClick={() => {
                    focusId.current = `audio-keep-${p.id}`;
                    setConfirm(p.id);
                  }}
                >{t`Delete`}</Button>
              )
            ) : null
          }
        />
      ))}
      <p
        id="audio-delete-result"
        role="status"
        tabIndex={-1}
        className={done ? "px-4 py-3 text-sm text-ink-muted" : "sr-only"}
      >
        {done}
      </p>
      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}
