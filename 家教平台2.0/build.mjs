import { build } from "esbuild";
import {
  mkdirSync,
  rmSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = import.meta.dirname;
const dist = resolve(root, "../dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(resolve(dist, "assets"), { recursive: true });
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await build({
  entryPoints: [resolve(root, "_worker.js")],
  outfile: resolve(dist, "_worker.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  define: { BUILD_COMMIT: JSON.stringify(commit) },
});
const client = await build({
  entryPoints: [resolve(root, "web/app.js")],
  outdir: resolve(dist, "assets"),
  entryNames: "app-[hash]",
  bundle: true,
  format: "esm",
  target: "es2022",
  metafile: true,
  minify: true,
});
const entry = Object.keys(client.metafile.outputs)
  .find((p) => p.endsWith(".js"))
  .split(/[\\/]/)
  .pop();
writeFileSync(
  resolve(dist, "index.html"),
  readFileSync(resolve(root, "web/index.html"), "utf8").replace(
    "/assets/app.js",
    `/assets/${entry}`,
  ),
);
for (const name of ["style.css", "_headers"])
  copyFileSync(resolve(root, "web", name), resolve(dist, name));
for (const name of ["hand-mask.png", "hand-mask-rot.png"])
  copyFileSync(resolve(root, name), resolve(dist, name));
writeFileSync(
  resolve(dist, "_routes.json"),
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }),
);
console.log(`经途·伴学 2.0 · ${commit} → ${dist}`);
