import { Redirect } from "@/components/Redirect";
import { DEFAULT_LOCALE, localePath } from "@/i18n/config";
import { listEntries } from "@/lib/docs/entries";

export const dynamicParams = false;

export function generateStaticParams() {
  return listEntries(DEFAULT_LOCALE, "guides").map((g) => ({ slug: g.slug }));
}

export default async function Legacy({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Redirect to={localePath(DEFAULT_LOCALE, `/guides/${slug}/`)} />;
}
