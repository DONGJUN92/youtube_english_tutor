#!/usr/bin/env node
/**
 * Nitro bundles `@electric-sql/pglite` into `_libs/electric-sql__pglite.mjs`
 * but does not copy `pglite.data` / `pglite.wasm` / `initdb.wasm`. Runtime
 * `new URL("./pglite.data", import.meta.url)` then ENOENTs on Vercel.
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];
const destDir = join(
  process.cwd(),
  ".vercel/output/functions/__server.func/_libs",
);
const srcDir = join(process.cwd(), "node_modules/@electric-sql/pglite/dist");

if (!existsSync(join(destDir, "electric-sql__pglite.mjs"))) {
  console.warn("[pglite-assets] bundled pglite module not found — skip");
  process.exit(0);
}

for (const name of files) {
  const from = join(srcDir, name);
  const to = join(destDir, name);
  if (!existsSync(from)) {
    console.warn(`[pglite-assets] missing ${from}`);
    continue;
  }
  copyFileSync(from, to);
  console.log(`[pglite-assets] copied ${name}`);
}
