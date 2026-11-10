import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  // Several root layouts (locale pages, legacy redirects) means the 404 page needs its own <html>.
  experimental: { globalNotFound: true },
};

// Plugins are named by string so the options stay serialisable (required by Turbopack).
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm", "remark-frontmatter", ["remark-mdx-frontmatter", { name: "frontmatter" }]],
    rehypePlugins: ["rehype-slug"],
  },
});

export default withMDX(config);
