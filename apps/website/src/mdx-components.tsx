import type { MDXComponents } from "mdx/types";

// Required by @next/mdx. Content is rendered with locale-aware components passed as a prop (see components/docs/mdx.tsx).
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return components;
}
