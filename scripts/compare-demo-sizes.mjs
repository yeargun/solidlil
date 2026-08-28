import { execFileSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const beforeRevision = process.argv[2]
if (!beforeRevision) throw new Error("usage: node scripts/compare-demo-sizes.mjs <git-revision>")

const before = JSON.parse(
  execFileSync("git", ["show", `${beforeRevision}:site/results.json`], {
    cwd: root,
    encoding: "utf8",
  }),
)
const after = JSON.parse(await readFile(resolve(root, "site", "results.json"), "utf8"))

const metric = (baseline, candidate) => ({
  baseline,
  candidate,
  reductionPercent: (1 - candidate / baseline) * 100,
})

const apps = after.examples.map((current) => {
  const previous = before.examples.find(({ id }) => id === current.id)
  if (!previous) throw new Error(`missing ${current.id} in ${beforeRevision}`)
  return {
    id: current.id,
    previous: {
      gzip: metric(previous.solid.gzip, previous.solidlil.gzip),
      brotli: metric(previous.solid.brotli, previous.solidlil.brotli),
    },
    current: {
      gzip: metric(current.solid.gzip, current.solidlil.gzip),
      brotli: metric(current.solid.brotli, current.solidlil.brotli),
    },
    candidateDeltaBytes: {
      gzip: current.solidlil.gzip - previous.solidlil.gzip,
      brotli: current.solidlil.brotli - previous.solidlil.brotli,
    },
  }
})

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  beforeRevision,
  comparisonStatus: "diagnostic-only-non-exact-runtime",
  counts: { apps: apps.length },
  totals: {
    previous: {
      gzip: before.metrics.gzip.solidlil,
      brotli: before.metrics.brotli.solidlil,
    },
    current: {
      gzip: after.metrics.gzip.solidlil,
      brotli: after.metrics.brotli.solidlil,
    },
    deltaBytes: {
      gzip: after.metrics.gzip.solidlil - before.metrics.gzip.solidlil,
      brotli: after.metrics.brotli.solidlil - before.metrics.brotli.solidlil,
    },
  },
  apps,
}

await writeFile(
  resolve(root, "site", "demo-size-delta.json"),
  `${JSON.stringify(report, null, 2)}\n`,
)
console.log(
  `Demo candidate totals: gzip ${report.totals.previous.gzip} -> ${report.totals.current.gzip} (${report.totals.deltaBytes.gzip}); ` +
    `Brotli ${report.totals.previous.brotli} -> ${report.totals.current.brotli} (${report.totals.deltaBytes.brotli}).`,
)
