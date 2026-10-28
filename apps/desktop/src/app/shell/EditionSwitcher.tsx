import { useState } from "react";
import * as M from "@radix-ui/react-dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { Check, ChevronDown, Globe, Plus } from "lucide-react";
import { translationProgress } from "@cadabracraft/format";
import { LOCALES } from "../../i18n/locales";
import { errText } from "../../lib/projectError";
import { AddLanguageDialog } from "../dialogs/AddLanguageDialog";
import { useProject } from "../../state/project/index";
import { menuContentClass, menuItemClass } from "../../ui/Menu";

export const nativeName = (code: string): string =>
  LOCALES.find((l) => l.code === code)?.nativeName ?? code;

/** The edition chip in the editor's top bar: shows the edition being written and switches or adds editions. */
export function EditionSwitcher() {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const active = useProject((s) => s.activeLanguage ?? s.manifest?.editions[0]?.language ?? "");
  const actions = useProject((s) => s.actions);
  const [adding, setAdding] = useState(false);
  if (!manifest) return null;
  const choose = (language: string) => {
    if (language === active) return;
    void actions.setLanguage(language).catch((e) => useProject.setState({ notice: errText(e) }));
  };
  return (
    <>
      <M.Root>
        <M.Trigger asChild>
          <button
            type="button"
            aria-label={t`Edition: ${nativeName(active)}`}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Globe size={14} aria-hidden className="text-accent" />
            <span className="max-w-32 truncate" dir="auto">
              {nativeName(active)}
            </span>
            <ChevronDown size={14} aria-hidden className="text-ink-muted" />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content align="start" className={menuContentClass("min-w-64")}>
            {manifest.editions.map((e) => {
              const p = translationProgress(manifest, e.language);
              const isActive = e.language === active;
              return (
                <M.Item
                  key={e.language}
                  className={menuItemClass(isActive && "bg-accent-soft")}
                  onSelect={() => choose(e.language)}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span dir="auto" className="truncate font-semibold">
                      {nativeName(e.language)}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {t`${p.translated} of ${p.total} chapters`}
                    </span>
                  </span>
                  {isActive && <Check size={14} aria-hidden className="text-accent" />}
                </M.Item>
              );
            })}
            <M.Separator className="my-1 h-px bg-border" />
            <M.Item className={menuItemClass("text-accent")} onSelect={() => setAdding(true)}>
              <Plus size={14} aria-hidden />
              {t`Add language`}
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
      <AddLanguageDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
