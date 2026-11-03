import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowLeft, Check } from "lucide-react";
import { TRIM_SIZES } from "@cadabracraft/export-pdf";
import {
  DEFAULT_TEMPLATE_ID,
  GALLERY_TEMPLATE_IDS,
  getTemplate,
  hasTemplate,
  type Template,
} from "@cadabracraft/templates";
import { Button, IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { useProject } from "../../state/project/index";
import { errText } from "../../lib/projectError";
import { Notice } from "../../ui/Notice";
import { Segmented } from "../../ui/Segmented";

const PREVIEW_LINES = [0, 1, 2, 3, 4, 5, 6, 7];

/** Mini page drawn with the template's body face, so the cards show the difference between looks. */
function MiniPage({ template }: { template: Template }) {
  const serif = /serif/i.test(template.print.bodyFonts[0] ?? "");
  return (
    <div
      aria-hidden
      className="flex h-[156px] w-[120px] flex-col gap-1.5 rounded-sm border border-border bg-paper p-4"
      style={{ fontFamily: serif ? "var(--font-book)" : "var(--font-ui)" }}
    >
      <span className="h-2 w-12 self-center rounded-full bg-ink-muted/70" />
      {PREVIEW_LINES.map((n) => (
        <span key={n} className={cx("h-px bg-ink-muted/40", n % 4 === 3 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Choose the book's template. The chosen template is saved in cadabra.json when the book uses it. */
export function Templates({ onBack }: { onBack: () => void }) {
  const { t } = useLingui();
  const manifest = useProject((s) => s.manifest);
  const setTemplate = useProject((s) => s.actions.setTemplate);
  const setBookDropCap = useProject((s) => s.actions.setBookDropCap);
  const current =
    manifest && hasTemplate(manifest.template) ? manifest.template : DEFAULT_TEMPLATE_ID;
  const [selected, setSelected] = useState(current);
  const [error, setError] = useState("");
  // A book that already uses Nonfiction keeps its card; the gallery otherwise shows the designed looks.
  const ids =
    current === "nonfiction" ? [...GALLERY_TEMPLATE_IDS, current] : [...GALLERY_TEMPLATE_IDS];
  const templates = ids.map((id) => getTemplate(id));
  const chosen = getTemplate(selected);
  const { print } = chosen;
  const trim = TRIM_SIZES[print.defaults.trimSize];
  const { marginsIn } = print.defaults;
  const apply = async () => {
    setError("");
    try {
      await setTemplate(selected);
      onBack();
    } catch (e) {
      setError(errText(e));
    }
  };
  const dropCap = manifest?.dropCap === undefined ? "default" : manifest.dropCap ? "on" : "off";
  const [dropCapSaid, setDropCapSaid] = useState("");
  const chooseDropCap = (v: "default" | "on" | "off") => {
    setError("");
    setBookDropCap(v === "default" ? null : v === "on").then(
      () =>
        setDropCapSaid(
          v === "default"
            ? t`Big first letter: template default`
            : v === "on"
              ? t`Big first letter: on`
              : t`Big first letter: off`,
        ),
      (e) => setError(errText(e)),
    );
  };
  const rows: [string, string][] = [
    [t`Trim size`, `${trim.w} × ${trim.h} in`],
    [t`Body font`, `${print.bodyFonts[0]} ${print.fontSizePt} pt`],
    [t`Line spacing`, `${print.leadingEm} em`],
    [t`Margins (in/out)`, `${marginsIn.inside} / ${marginsIn.outside} in`],
    [
      t`Chapter opener`,
      print.chapterOpening.startOn === "recto" ? t`Right-hand page` : t`Any page`,
    ],
    [t`Scene break`, print.sceneBreak.glyph],
  ];

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton icon={ArrowLeft} label={t`Back`} onClick={onBack} />
          <h1 className="font-book text-base font-semibold">{t`Templates`}</h1>
        </div>
        <Button
          variant="primary"
          icon={Check}
          disabled={selected === current}
          onClick={() => void apply()}
        >{t`Use template`}</Button>
      </header>
      {error && (
        <Notice role="alert" className="mx-4 mt-4">
          {error}
        </Notice>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main
          id="main"
          tabIndex={-1}
          className="outline-none flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6 md:p-8"
        >
          <h2 className="font-book text-2xl font-semibold">{t`Choose a look for your book`}</h2>
          <div
            role="radiogroup"
            aria-label={t`Templates`}
            className="flex flex-wrap gap-4"
            onKeyDown={(e) => {
              // ArrowRight moves toward the visual right, which is backwards in a right-to-left layout.
              const fwd =
                getComputedStyle(e.currentTarget).direction === "rtl" ? "ArrowLeft" : "ArrowRight";
              const back = fwd === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
              const step =
                e.key === fwd || e.key === "ArrowDown"
                  ? 1
                  : e.key === back || e.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!step) return;
              e.preventDefault();
              const at = templates.findIndex((x) => x.id === selected);
              const next = templates[(at + step + templates.length) % templates.length];
              if (!next) return;
              setSelected(next.id);
              e.currentTarget.querySelector<HTMLElement>(`[data-template="${next.id}"]`)?.focus();
            }}
          >
            {templates.map((tpl) => {
              const on = tpl.id === selected;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  data-template={tpl.id}
                  onClick={() => setSelected(tpl.id)}
                  className={cx(
                    "flex w-62.5 flex-col items-center gap-3 rounded-lg border bg-surface p-4 text-start transition-colors focus-visible:outline-2 focus-visible:outline-accent",
                    on
                      ? "border-accent bg-accent-soft/40"
                      : "border-border-strong hover:bg-accent-soft/40",
                  )}
                >
                  <MiniPage template={tpl} />
                  <span className="flex w-full flex-col gap-0.5">
                    <span className="text-sm font-semibold">
                      {tpl.name}
                      {tpl.id === current ? ` · ${t`In use`}` : ""}
                    </span>
                    <span className="text-xs text-ink-muted">{tpl.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </main>
        <aside
          aria-labelledby="template-details"
          className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-border bg-surface p-5 lg:w-[360px] lg:border-s lg:border-t-0"
        >
          <h2 id="template-details" className="font-book text-lg font-semibold">
            {chosen.name}
          </h2>
          <dl className="flex flex-col divide-y divide-border">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="min-w-0 truncate text-end font-medium" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t`Big first letter`}</h3>
            <Segmented
              label={t`Big first letter`}
              value={dropCap}
              onChange={chooseDropCap}
              items={[
                {
                  value: "default",
                  label: print.chapterOpening.dropCap
                    ? t`Template default (on)`
                    : t`Template default (off)`,
                },
                { value: "on", label: t`On` },
                { value: "off", label: t`Off` },
              ]}
            />
            <p className="text-xs text-ink-muted">
              {t`Applies to every chapter that has no choice of its own. Set one chapter from its menu in the chapter list.`}
            </p>
            <p role="status" className="sr-only">
              {dropCapSaid}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
