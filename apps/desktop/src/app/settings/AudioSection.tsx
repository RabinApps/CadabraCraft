import { useCallback, useEffect, useState } from "react";
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
  const remove = async (id: string) => {
    setConfirm(null);
    setError(null);
    try {
      await bridge.audioDeletePack(id);
    } catch (e) {
      setError(describeAudioError(e).message);
    }
    await refresh();
  };
  const packName = (p: VoicePack) =>
    p.id === "piper" ? t`Piper voices: Amy and LibriTTS` : t`Kokoro: Heart`;
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
                <div className="flex gap-2">
                  <Button onClick={() => setConfirm(null)}>{t`Keep`}</Button>
                  <Button
                    variant="danger"
                    onClick={() => void remove(p.id)}
                  >{t`Delete voices`}</Button>
                </div>
              ) : (
                <Button onClick={() => setConfirm(p.id)}>{t`Delete`}</Button>
              )
            ) : null
          }
        />
      ))}
      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}
