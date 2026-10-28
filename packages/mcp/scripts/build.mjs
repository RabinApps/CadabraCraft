// Bundles src/cli.ts and every dependency (workspace packages are TypeScript source, so they must be bundled) into one
// self-contained dist/cli.js. Usage: pnpm --filter @cadabracraft/mcp build   (then: node packages/mcp/dist/cli.js <root>)
import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("..", import.meta.url));

await build({
  entryPoints: [`${pkg}src/cli.ts`],
  outfile: `${pkg}dist/cli.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  legalComments: "none",
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __cadabraCreateRequire } from "node:module";\nconst require = __cadabraCreateRequire(import.meta.url);',
  },
  logLevel: "warning",
});
chmodSync(`${pkg}dist/cli.js`, 0o755);
console.error("built packages/mcp/dist/cli.js");
