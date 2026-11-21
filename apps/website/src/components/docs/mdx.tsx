import type { MDXComponents } from "mdx/types";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Screenshot } from "@/components/Screenshot";
import { localePath, type Locale } from "@/i18n/config";

export function Callout({
  children,
  tone = "note",
}: {
  children: ReactNode;
  tone?: "note" | "warn";
}) {
  const cls = tone === "warn" ? "border-warn" : "border-accent";
  return (
    <aside className={`my-5 rounded-md border-s-4 ${cls} bg-surface px-4 py-3 text-ink`}>
      {children}
    </aside>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-sidebar px-1.5 py-0.5 font-mono text-[0.85em]">
      {children}
    </kbd>
  );
}

/** A guide screenshot in both colour schemes with a caption. `alt` says what the picture shows, for screen readers. */
export function Shot({ name, alt, caption }: { name: string; alt: string; caption?: string }) {
  return (
    <figure className="my-6 overflow-hidden rounded-lg border border-border">
      <Screenshot name={name} alt={alt} />
      {caption && (
        <figcaption className="border-t border-border bg-surface px-4 py-2 text-sm text-ink-muted">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/** MDX element styling. Links that start with "/" are site paths and get the locale prefix. */
export function mdxComponents(locale: Locale): MDXComponents {
  return {
    h2: (p) => <h2 {...p} className="mt-12 scroll-mt-24 font-book text-3xl font-semibold" />,
    h3: (p) => <h3 {...p} className="mt-8 scroll-mt-24 font-book text-2xl font-semibold" />,
    h4: (p) => <h4 {...p} className="mt-6 scroll-mt-24 text-lg font-semibold" />,
    p: (p) => <p {...p} className="mt-4 leading-relaxed" />,
    ul: (p) => <ul {...p} className="mt-4 list-disc space-y-2 ps-6 leading-relaxed" />,
    ol: (p) => <ol {...p} className="mt-4 list-decimal space-y-2 ps-6 leading-relaxed" />,
    blockquote: (p) => (
      <blockquote {...p} className="mt-4 border-s-4 border-border ps-4 text-ink-muted" />
    ),
    a: ({ href = "", ...rest }: ComponentPropsWithoutRef<"a">) => {
      const external = /^https?:\/\//.test(href);
      return (
        <a
          {...rest}
          href={localePath(locale, href)}
          {...(external ? { rel: "noopener noreferrer" } : {})}
          className="text-accent underline underline-offset-2 hover:no-underline"
        />
      );
    },
    code: (p) => <code {...p} className="rounded bg-sidebar px-1 py-0.5 font-mono text-[0.9em]" />,
    pre: (p) => (
      <pre
        {...p}
        tabIndex={0}
        className="mt-4 overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-sm leading-relaxed [&_code]:bg-transparent [&_code]:p-0"
      />
    ),
    table: (p) => (
      <div className="mt-4 overflow-x-auto">
        <table {...p} className="w-full text-start text-sm" />
      </div>
    ),
    th: (p) => (
      <th
        {...p}
        scope="col"
        className="border-b border-border px-3 py-2 text-start font-semibold"
      />
    ),
    td: (p) => <td {...p} className="border-b border-border px-3 py-2 align-top" />,
    hr: (p) => <hr {...p} className="my-10 border-border" />,
    Callout,
    Kbd,
    Shot,
  };
}
