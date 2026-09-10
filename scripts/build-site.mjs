import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const output = join(root, "_site")

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(join(root, "site"), output, { recursive: true })
await writeFile(join(output, ".nojekyll"), "")

console.log(`Built GitHub Pages site at ${output}`)

// Refuse publication if source or served artifacts drift from this measurement.
await import("./build-audit.mjs").then(({writeAudit}) => writeAudit({root, output}));
