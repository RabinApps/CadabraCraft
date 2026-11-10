import { Redirect } from "@/components/Redirect";
import { DEFAULT_LOCALE, localePath } from "@/i18n/config";

export default function Legacy() {
  return <Redirect to={localePath(DEFAULT_LOCALE, "/guides/")} />;
}
