import { type KeyboardEvent, type Ref } from "react";
import type { Editor } from "@tiptap/react";
import { useLingui } from "@lingui/react/macro";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button, IconButton } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Field } from "../../ui/forms/Input";
import { readingOrder, entryRows } from "@cadabracraft/format";
import { useProject } from "../../state/project/index";
import { bookPosition, countLabel, isComposing, resultRows } from "../../lib/search/findHelpers";
import { MAX_QUERY_CHARS, MAX_REPLACEMENT_CHARS, useFind, type FindState } from "./findStore";
import { isInvalidRegex } from "../../lib/search/match";
import { useBookCounts, useLanguageCounts, useSearchInfo } from "./findHooks";
import { useFindActions, type FindToggle } from "./findActions";
import { nativeName } from "../../app/shell/header/EditionSwitcher";
import { Chip } from "../../ui/feedback/Chip";
import { FindResults } from "./FindResults";

function FindRow(props: {
  f: FindState;
  findRef: Ref<HTMLInputElement>;
  invalid: boolean;
  noResults: boolean;
  info: { total: number; index: number };
  later: () => void;
  step: (dir: 1 | -1) => void;
  close: () => void;
}) {
  const { t } = useLingui();
  const { f, info, step } = props;
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <Field
          ref={props.findRef}
          label={t`Find`}
          errorId={props.invalid ? "find-count" : undefined}
          hideLabel
          placeholder={t`Find`}
          value={f.query}
          maxLength={MAX_QUERY_CHARS}
          className="py-1.5"
          onChange={(e) => {
            f.set({ query: e.target.value });
            props.later();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isComposing(e.nativeEvent)) {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
      </div>
      <span
        id="find-count"
        aria-live="polite"
        className={cx(
          "min-w-14 shrink-0 text-end text-xs tabular-nums",
          props.noResults || props.invalid ? "text-danger" : "text-ink-muted",
        )}
      >
        {props.invalid ? t`Invalid pattern` : countLabel(f.query, info.total, info.index)}
      </span>
      <IconButton
        icon={ChevronUp}
        label={t`Previous match`}
        onClick={() => step(-1)}
        disabled={info.total === 0}
      />
      <IconButton
        icon={ChevronDown}
        label={t`Next match`}
        onClick={() => step(1)}
        disabled={info.total === 0}
      />
      <IconButton icon={X} label={t`Close`} onClick={props.close} />
    </div>
  );
}

function ReplaceRow(props: {
  f: FindState;
  later: () => void;
  replaceOne: () => void;
  replaceAll: () => void;
  oneDisabled: boolean;
  allDisabled: boolean;
}) {
  const { t } = useLingui();
  const { f, replaceOne } = props;
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <Field
          label={t`Replace with`}
          hideLabel
          placeholder={t`Replace with`}
          value={f.replacement}
          maxLength={MAX_REPLACEMENT_CHARS}
          className="py-1.5"
          onChange={(e) => {
            f.set({ replacement: e.target.value });
            props.later();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isComposing(e.nativeEvent)) {
              e.preventDefault();
              replaceOne();
            }
          }}
        />
      </div>
      <Button size="sm" onClick={replaceOne} disabled={props.oneDisabled}>{t`Replace`}</Button>
      <Button
        size="sm"
        onClick={props.replaceAll}
        disabled={props.allDisabled}
      >{t`Replace all`}</Button>
    </div>
  );
}

function FindOptions(props: {
  f: FindState;
  multiLanguage: boolean;
  toggle: (patch: FindToggle) => void;
}) {
  const { t } = useLingui();
  const { f, toggle } = props;
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Chip
          pressed={f.matchCase}
          onClick={() => toggle({ matchCase: !f.matchCase })}
        >{t`Match case`}</Chip>
        <Chip
          pressed={f.wholeWord}
          onClick={() => toggle({ wholeWord: !f.wholeWord })}
        >{t`Whole word`}</Chip>
        <Chip
          pressed={f.allChapters}
          onClick={() => toggle({ allChapters: !f.allChapters })}
        >{t`All chapters`}</Chip>
        <Chip pressed={f.regex} onClick={() => toggle({ regex: !f.regex })}>{t`Regex`}</Chip>
      </div>
      {f.allChapters && props.multiLanguage && (
        <div className="flex items-center gap-1.5">
          <Chip
            pressed={f.allLanguages}
            onClick={() => toggle({ allLanguages: !f.allLanguages })}
          >{t`All languages`}</Chip>
        </div>
      )}
    </>
  );
}

function LanguageTotals(props: { languages: string[]; totals: Record<string, number> }) {
  const { t } = useLingui();
  return (
    <ul
      aria-label={t`Matches by language`}
      className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-xs text-ink-muted"
    >
      {props.languages.map((language) => (
        <li key={language} className="tabular-nums">
          {nativeName(language)}: {props.totals[language] ?? 0}
        </li>
      ))}
    </ul>
  );
}

/**
 * Find and replace bar, docked top-right of the writing area (full width under the top bar on phones). It is a toolbar,
 * not a modal: focus is not trapped. It is available in Write mode only (the search plugin is not loaded when reading),
 * and also in Focus mode, where it sits below the "Exit focus mode" button, so Cmd/Ctrl+F still works with the chrome hidden.
 */
export function FindBar({ editor, focusMode }: { editor: Editor; focusMode?: boolean }) {
  const { t } = useLingui();
  const f = useFind();
  const editorInfo = useSearchInfo(editor);
  const manifest = useProject((s) => s.manifest);
  const currentId = useProject((s) => s.currentId);
  const options = {
    query: f.query,
    matchCase: f.matchCase,
    wholeWord: f.wholeWord,
    regex: f.regex,
  };
  const counts = useBookCounts(f.allChapters, options, editorInfo.total);
  // "All languages" only exists in a book with translations, and only together with "All chapters".
  const multiLanguage = (manifest?.editions.length ?? 0) > 1;
  const allLanguages = f.allChapters && f.allLanguages && multiLanguage;
  const languageTotals = useLanguageCounts(allLanguages, options, editorInfo.total);
  const languageMatches = Object.values(languageTotals).reduce((a, b) => a + b, 0);
  const order = manifest ? readingOrder(manifest).map((e) => e.id) : [];
  const info = f.allChapters ? bookPosition(order, counts, currentId, editorInfo) : editorInfo;
  const actions = useFindActions({ editor, order, counts, currentId, allLanguages });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !isComposing(e.nativeEvent)) {
      // Stop here so focus mode's own Escape does not also exit.
      e.preventDefault();
      e.stopPropagation();
      actions.close();
    }
  };
  const invalid = f.regex && isInvalidRegex(f.query, f.matchCase);
  const noResults = f.query !== "" && info.total === 0;
  const rows =
    f.allChapters && !invalid && manifest
      ? resultRows(
          {
            frontMatter: entryRows(manifest.frontMatter, manifest.editions),
            chapters: entryRows(manifest.chapters, manifest.editions),
            backMatter: entryRows(manifest.backMatter, manifest.editions),
          },
          counts,
          currentId,
          editorInfo,
        )
      : [];

  return (
    <div
      role="search"
      aria-label={t`Find and replace`}
      onKeyDown={onKeyDown}
      className={cx(
        "z-(--z-panel) flex flex-col gap-2 border border-border bg-raised p-2 text-ink shadow-popover",
        // On a phone the bar sits above the text, not over it: the whole short chapter would be hidden behind it (WCAG 2.4.11).
        "max-md:relative max-md:border-x-0 max-md:border-t-0",
        "md:absolute md:end-4 md:w-[380px] md:rounded-lg",
        focusMode ? "md:top-14" : "md:top-3",
      )}
    >
      <FindRow
        f={f}
        findRef={actions.findRef}
        invalid={invalid}
        noResults={noResults}
        info={info}
        later={actions.later}
        step={actions.step}
        close={actions.close}
      />
      {f.replace && (
        <ReplaceRow
          f={f}
          later={actions.later}
          replaceOne={actions.replaceOne}
          replaceAll={actions.replaceAll}
          oneDisabled={info.total === 0}
          allDisabled={allLanguages ? languageMatches === 0 : info.total === 0}
        />
      )}
      <FindOptions f={f} multiLanguage={multiLanguage} toggle={actions.toggle} />
      {allLanguages && f.query !== "" && !invalid && manifest && (
        <LanguageTotals
          languages={manifest.editions.map((e) => e.language)}
          totals={languageTotals}
        />
      )}
      <FindResults rows={rows} onOpen={actions.openRow} />
    </div>
  );
}
