import { pageMetadata } from "@/lib/seo";
import { btnPrimary, btnSecondary } from "@/lib/site";

// No canonical: this is not a real page, so only the noindex matters.
export const metadata = {
  ...pageMetadata("Page not found", "This page is not in the book.", "/404/", { noindex: true }),
  alternates: undefined,
};

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="font-book text-7xl font-medium text-accent sm:text-8xl">404</p>
      <h1 className="font-book text-3xl font-semibold">This page is not in the book</h1>
      <p className="text-ink-muted">The link may be old or mistyped. Try one of these instead.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <a href="/" className={btnPrimary}>
          Back to home
        </a>
        <a href="/features/" className={btnSecondary}>
          Features
        </a>
        <a href="/compare/" className={btnSecondary}>
          Compare
        </a>
      </div>
    </div>
  );
}
