import { useLingui } from "@lingui/react/macro";
import type { LucideIcon } from "lucide-react";
import { ENTRY_ICONS, type EntryIcon } from "@cadabracraft/format";
import { COMPONENTS } from "./chapterIcons";

/** Name, component and translated label of every allowed icon, in picker order. */
export function useIconChoices(): { name: EntryIcon; Icon: LucideIcon; label: string }[] {
  const { t } = useLingui();
  const labels: Record<EntryIcon, string> = {
    "book-open": t`Open book`,
    feather: t`Feather`,
    scroll: t`Scroll`,
    map: t`Map`,
    compass: t`Compass`,
    anchor: t`Anchor`,
    ship: t`Ship`,
    mountain: t`Mountain`,
    trees: t`Forest`,
    leaf: t`Leaf`,
    sun: t`Sun`,
    moon: t`Moon`,
    "cloud-lightning": t`Storm`,
    flame: t`Flame`,
    star: t`Star`,
    heart: t`Heart`,
    skull: t`Skull`,
    ghost: t`Ghost`,
    eye: t`Eye`,
    key: t`Key`,
    gem: t`Gem`,
    crown: t`Crown`,
    castle: t`Castle`,
    shield: t`Shield`,
    swords: t`Swords`,
    "wand-sparkles": t`Magic wand`,
    bird: t`Bird`,
    flag: t`Flag`,
    music: t`Music`,
  };
  return ENTRY_ICONS.map((name) => ({ name, Icon: COMPONENTS[name], label: labels[name] }));
}
