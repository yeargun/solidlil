import { readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const resultsPath = process.argv[2]
  ?? resolve(root, "../lilscript/benchmarks/js-framework-benchmark/artifacts/results.json")
const sitePath = resolve(root, "site", "results.json")

const CPU = {
  "01_run1k": "Create 1,000 rows",
  "02_replace1k": "Replace 1,000 rows",
  "03_update10th1k_x16": "Update every 10th row ×16",
  "04_select1k": "Select a row",
  "05_swap1k": "Swap two rows",
  "06_remove-one-1k": "Remove one row",
  "07_create10k": "Create 10,000 rows",
  "08_create1k-after1k_x2": "Append 1,000 rows ×2",
  "09_clear1k_x8": "Clear 1,000 rows ×8",
}
const MEMORY = {
  "21_ready-memory": "Ready memory",
  "22_run-memory": "Memory with 1,000 rows",
  "25_run-clear-memory": "Memory after five create/clear cycles",
}

const official = JSON.parse(await readFile(resultsPath, "utf8"))
const site = JSON.parse(await readFile(sitePath, "utf8"))
const solid = official.frameworks.find((row) => row.id === "solid-v2")
const lil = official.frameworks.find((row) => row.id === "solidlil-v2")
if (!solid || !lil) throw new Error("results.json is missing solid-v2 or solidlil-v2")

async function assertCurrentArtifact(framework, path) {
  const files = framework.size?.files ?? []
  if (files.length !== 1 || files[0].file !== "main.js") {
    throw new Error(`${framework.id} must contain exactly one measured main.js`)
  }
  const digest = createHash("sha256").update(await readFile(path)).digest("hex")
  if (files[0].sha256 !== digest) {
    throw new Error(`${framework.id} results belong to a different bundle hash`)
  }
}

await assertCurrentArtifact(
  solid,
  resolve(root, "benchmarks/js-framework-benchmark/keyed/solid-v2/dist/main.js"),
)
await assertCurrentArtifact(
  lil,
  resolve(root, "benchmarks/js-framework-benchmark/keyed/solidlil/dist/main.js"),
)

function median(framework, section, id, metric) {
  const row = framework[section][id]
  const value = metric ? row?.[metric] : row
  if (value?.median == null) throw new Error(`missing ${framework.id} ${section} ${id}`)
  return value.median
}

function geomean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length)
}

const cpu = official.status?.cpu?.complete
  ? Object.entries(CPU).map(([id, name]) => {
      const solidMs = median(solid, "cpu", id, "total")
      const lilMs = median(lil, "cpu", id, "total")
      return { id, name, solid: solidMs, solidlil: lilMs, ratio: lilMs / solidMs }
    })
  : []
const memory = official.status?.memory?.complete
  ? Object.entries(MEMORY).map(([id, name]) => {
      const solidMb = median(solid, "memory", id)
      const lilMb = median(lil, "memory", id)
      return { id, name, solid: solidMb, solidlil: lilMb, ratio: lilMb / solidMb }
    })
  : []
const allRatios = cpu.map((row) => row.ratio)
const selectSameApp = cpu.length === Object.keys(CPU).length

site.jsFrameworkBenchmark = {
  ...site.jsFrameworkBenchmark,
  status: {
    size: official.status?.size?.complete ? "current" : "incomplete",
    cpu: official.status?.cpu?.complete ? "current" : "not-measured-for-current-artifacts",
    memory: official.status?.memory?.complete
      ? "current"
      : "not-measured-for-current-artifacts",
  },
  source: official.upstream?.repository ?? "https://github.com/krausest/js-framework-benchmark",
  commit: official.upstream?.commit ?? official.provenance?.upstreamCommit,
  browser: official.provenance?.chrome,
  blocks: official.configuration?.blocks ?? 15,
  cpuThrottling: official.configuration?.cpuThrottling ?? true,
  geomean: {
    cpu: allRatios.length ? geomean(allRatios) : null,
    cpuSameApp: selectSameApp ? geomean(allRatios) : null,
  },
  notes: {
    cpuSameApp:
      "Geometric mean of all nine keyed workloads. Both sides read selected() on every row — same algorithm as official Solid 2.0.",
    select:
      "04_select1k reads selected() on every row on both sides.",
  },
  selectSameApp,
  sizes: {
    solid: {
      raw: solid.size.jsRaw,
      gzip: solid.size.jsGzip,
      brotli: solid.size.jsBrotli,
    },
    solidlil: {
      raw: lil.size.jsRaw,
      gzip: lil.size.jsGzip,
      brotli: lil.size.jsBrotli,
    },
  },
  cpu,
  memory,
}

await writeFile(sitePath, `${JSON.stringify(site, null, 2)}\n`)
const size = site.jsFrameworkBenchmark.sizes
console.log(JSON.stringify({
  sizes: size,
  brotliReduction: (1 - size.solidlil.brotli / size.solid.brotli) * 100,
  cpu: site.jsFrameworkBenchmark.geomean,
}, null, 2))
