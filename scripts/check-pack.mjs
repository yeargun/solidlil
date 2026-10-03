import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const result = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }))[0]
const required = new Set([
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.bundle.js",
  "dist/core.js",
  "dist/core.cjs",
  "dist/web.js",
  "dist/web.cjs",
  "dist/full.js",
  "dist/full.cjs",
  "dist/compat.js",
  "dist/solidlil.global.js",
  "types/index.d.ts",
  "types/web.d.ts",
  "types/full.d.ts",
])
const files = new Set(result.files.map(({ path }) => path))
for (const path of required) {
  if (!files.has(path)) throw new Error(`npm tarball is missing ${path}`)
}
if ([...files].some((path) => path.startsWith("dist/apps/") || path.startsWith("src/"))) {
  throw new Error("npm tarball must not include apps or source")
}
const manifest = JSON.parse(readFileSync("package.json", "utf8"))
if (manifest.name !== "@itslil/solidjs") throw new Error("unexpected package name")
// Retain the compiler's effect metadata: marking every initializer pure can
// remove shared reactive state or compatibility setup during application builds.
const delivery = JSON.parse(readFileSync("dist/lilscript.manifest.json", "utf8"))
const expected = new Set(delivery.outputs.flatMap(output => output.side_effects.map(file => `./dist/${file}`)))
for (const [alias, source] of Object.entries(delivery.aliases)) {
  if (expected.has(`./dist/${source}`)) expected.add(`./dist/${alias}`)
}
if (JSON.stringify(manifest.sideEffects) !== JSON.stringify([...expected].sort())) {
  throw new Error("package sideEffects must match the compiler delivery manifest")
}
console.log(`npm pack: ${result.entryCount} files, ${result.size} bytes packed, ${result.unpackedSize} bytes unpacked`)
