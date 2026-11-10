import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import type { Entry, Kind } from "./entries";

export type MdxContent = ComponentType<{ components?: MDXComponents }>;

/** Import the compiled MDX component for an entry (its own locale file, or the default-locale one). */
export async function loadContent(entry: Entry, kind: Kind): Promise<MdxContent> {
  const mod = (await import(`@/content/${entry.locale}/${kind}/${entry.slug}.mdx`)) as {
    default: MdxContent;
  };
  return mod.default;
}
