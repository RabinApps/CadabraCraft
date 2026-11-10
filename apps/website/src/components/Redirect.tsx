import { SITE_URL } from "@/lib/site";

/**
 * A static redirect for hosts that cannot send HTTP redirects (GitHub Pages): meta refresh, a script, a canonical
 * link to the target and a visible link. Search engines treat the meta refresh like a redirect.
 */
export function Redirect({ to }: { to: string }) {
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${to}`} />
      <meta name="robots" content="noindex" />
      <link rel="canonical" href={`${SITE_URL}${to}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `location.replace(${JSON.stringify(to)}+location.hash)`,
        }}
      />
      <p className="p-8 text-center">
        <a href={to} className="text-accent underline">
          {to}
        </a>
      </p>
    </>
  );
}
