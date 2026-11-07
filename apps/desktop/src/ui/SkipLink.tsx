import { useLingui } from "@lingui/react/macro";

/** The first tab stop: jumps past the header and side panels to the page's `<main id="main">`. Visible only while focused. */
export function SkipLink() {
  const { t } = useLingui();
  return (
    <a
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById("main")?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-(--z-menu) focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
    >
      {t`Skip to main content`}
    </a>
  );
}
