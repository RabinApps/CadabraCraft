// typescript-eslint does not support TypeScript 7 yet (typescript-eslint#10940).
// Give the lint toolchain its own TypeScript 6 and leave the repo's compiler on 7.
const LINT_TS = new Set(["typescript-eslint", "ts-api-utils"]);

function readPackage(pkg) {
  if (LINT_TS.has(pkg.name) || pkg.name.startsWith("@typescript-eslint/")) {
    if (pkg.peerDependencies?.typescript) {
      delete pkg.peerDependencies.typescript;
      pkg.dependencies = { ...pkg.dependencies, typescript: "npm:typescript@6.0.3" };
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
