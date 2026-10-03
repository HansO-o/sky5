import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Emits sw.js: precaches the app shell (HTML, JS/CSS chunks, decoders, manifest) so a second visit
 * and offline play start without the network. Game data under data/ is cached by the asset worker in
 * IndexedDB, so the service worker leaves those requests alone.
 */
function serviceWorker(): Plugin {
  return {
    name: "northern-sw",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const pub = path.resolve(__dirname, "public");
      const walk = (d: string): string[] =>
        fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
          const p = path.join(d, e.name);
          return e.isDirectory() ? walk(p) : [path.relative(pub, p).split(path.sep).join("/")];
        });
      const extra = walk(path.join(pub, "decoders")).concat(["manifest.json"]);
      const shell = ["./", ...files, ...extra].filter((f) => f !== "sw.js");
      const version = crypto.createHash("sha256").update(JSON.stringify(shell)).update(fs.readFileSync(path.join(pub, "manifest.json"))).digest("hex").slice(0, 12);
      const src = fs.readFileSync(path.resolve(__dirname, "src/sw.template.js"), "utf8").replace("__VERSION__", version).replace("__SHELL__", JSON.stringify(shell));
      this.emitFile({ type: "asset", fileName: "sw.js", source: src });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [serviceWorker()],
  build: {
    target: "es2022",
    assetsDir: "app",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  worker: { format: "es" },
  server: { port: 5173, host: true },
});
