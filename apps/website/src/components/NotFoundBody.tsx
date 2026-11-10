import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { btnPrimary, btnSecondary } from "@/lib/site";

export function NotFoundBody({ locale }: { locale: Locale }) {
  const m = getMessages(locale);
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="font-book text-7xl font-medium text-accent sm:text-8xl">404</p>
      <h1 className="font-book text-3xl font-semibold">{m.notFound.title}</h1>
      <p className="text-ink-muted">{m.notFound.lead}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <a href={localePath(locale, "/")} className={btnPrimary}>
          {m.notFound.home}
        </a>
        <a href={localePath(locale, "/features/")} className={btnSecondary}>
          {m.nav.features}
        </a>
        <a href={localePath(locale, "/docs/")} className={btnSecondary}>
          {m.nav.docs}
        </a>
      </div>
    </div>
  );
}
