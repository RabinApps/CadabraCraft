import { useLingui } from "@lingui/react/macro";
import type { MatterKind } from "@cadabracraft/shared";

/** Menu label of a page preset. Literal strings so Lingui can extract them. */
export function useKindLabels() {
  const { t } = useLingui();
  const labels: Record<MatterKind, string> = {
    "title-page": t`Title page`,
    copyright: t`Copyright page`,
    dedication: t`Dedication`,
    epigraph: t`Epigraph`,
    contents: t`Contents`,
    foreword: t`Foreword`,
    preface: t`Preface`,
    custom: t`Custom page`,
    blank: t`Blank page`,
    acknowledgments: t`Acknowledgments`,
    "about-the-author": t`About the author`,
    "also-by": t`Also by`,
    colophon: t`Colophon`,
  };
  return labels;
}
