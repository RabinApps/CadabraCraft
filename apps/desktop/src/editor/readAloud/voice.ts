import { bridge } from "../../lib/bridge";
import { voicesFor } from "../../lib/audio/audioFormats";

/**
 * The installed voice that reads `language` for read aloud: the preferred one (the audiobook's Settings default) when it
 * reads the language, else the best installed one. "" when no voice reads the language.
 */
export async function chooseReadingVoice(language: string, preferred: string): Promise<string> {
  const readers = voicesFor(await bridge.audioVoices(), language);
  return (readers.find((v) => v.id === preferred) ?? readers[0])?.id ?? "";
}
