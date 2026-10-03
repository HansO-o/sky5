// Unit tests: Vite SSR-builds every tests/unit/**/*.test.ts (aliases and `?url` imports as in the app,
// dependencies bundled so extensionless Babylon imports resolve) into .cache/unit/, then runs them
// with `node --test`. Arguments narrow the run to test files whose path contains any of them:
//   npm run test:unit -- physics flags
// (Moves to tools/engine/test/unit.mjs with the framework migration.)
import { build } from "vite";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testsDir = path.join(root, "tests/unit");
const outDir = path.join(root, ".cache/unit");
const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".test.ts") ? [p] : [];
  });
const files = walk(testsDir)
  .filter((f) => !filters.length || filters.some((s) => path.relative(testsDir, f).includes(s)))
  .sort();
if (!files.length) {
  console.error(filters.length ? `no unit tests match ${filters.join(", ")}` : "no unit tests found");
  process.exit(1);
}
const input = Object.fromEntries(files.map((f) => [path.relative(testsDir, f).replace(/\.ts$/, ""), f]));

await build({
  configFile: false,
  root,
  logLevel: "warn",
  resolve: { alias: [{ find: /^@engine\//, replacement: path.join(root, "src/engine") + "/" }] },
  // what vite.config.ts defines for the app
  define: { __MANIFEST_VERSION__: JSON.stringify("test") },
  // bundle dependencies (Babylon's ES build imports without file extensions, which Node rejects),
  // except Jolt: tests load its wasm from node_modules themselves
  ssr: { noExternal: [/^(?!jolt-physics)/], external: ["jolt-physics"] },
  build: {
    ssr: true,
    outDir,
    emptyOutDir: true,
    target: "node22",
    minify: false,
    sourcemap: "inline",
    reportCompressedSize: false,
    rollupOptions: { input, output: { format: "es", entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" } },
  },
});

const built = Object.keys(input).map((k) => path.join(outDir, `${k}.mjs`));
const r = spawnSync(process.execPath, ["--enable-source-maps", "--test", "--test-reporter=spec", ...built], { stdio: "inherit", cwd: root });
process.exit(r.status ?? 1);
