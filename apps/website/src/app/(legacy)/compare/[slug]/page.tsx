import { Redirect } from "@/components/Redirect";
import { getContent } from "@/content";
import { DEFAULT_LOCALE, localePath } from "@/i18n/config";

export const dynamicParams = false;

export function generateStaticParams() {
  return getContent(DEFAULT_LOCALE).competitors.competitors.map((c) => ({ slug: c.slug }));
}

export default async function Legacy({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Redirect to={localePath(DEFAULT_LOCALE, `/compare/${slug}/`)} />;
}
