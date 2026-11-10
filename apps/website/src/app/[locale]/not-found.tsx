import { NotFoundBody } from "@/components/NotFoundBody";
import { DEFAULT_LOCALE } from "@/i18n/config";

// Not-found boundaries get no route params, so this uses the default language.
export const metadata = { title: "Page not found", robots: { index: false, follow: true } };

export default function NotFound() {
  return <NotFoundBody locale={DEFAULT_LOCALE} />;
}
