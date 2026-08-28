import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { join, resolve, dirname } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import * as runtime from "../dist/index.js"
import { apps } from "../scripts/apps.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const read = (path) => readFile(join(root, path), "utf8")
const results = JSON.parse(await read("site/results.json"))
const upstreamPort = JSON.parse(await read("site/upstream-port.json"))
const demoE2e = JSON.parse(await read("site/demo-e2e.json"))
const demoDelta = JSON.parse(await read("site/demo-size-delta.json"))

test("the Pages lab contains every paired Solid 2.0 demo", () => {
  assert.equal(results.examples.length, apps.length)
  assert.equal(results.cases, apps.length)
  assert.deepEqual(results.examples.map((example) => example.id), apps.map((app) => app.id))
  for (const example of results.examples) {
    assert.ok(example.solid.raw > 0 && example.solid.gzip > 0 && example.solid.brotli > 0)
    assert.ok(example.solidlil.raw > 0 && example.solidlil.gzip > 0 && example.solidlil.brotli > 0)
    assert.ok(example.solid.gzip <= example.solid.raw)
    assert.ok(example.solid.brotli <= example.solid.raw)
    assert.ok(example.solidlil.gzip <= example.solidlil.raw)
    assert.ok(example.solidlil.brotli <= example.solidlil.raw)
  }
})

test("every paired demo has a passing browser scenario", () => {
  assert.equal(demoE2e.complete, true)
  assert.deepEqual(demoE2e.counts, { expected: apps.length, verified: apps.length })
  assert.deepEqual(demoE2e.apps.map(({ id }) => id).sort(), apps.map(({ id }) => id).sort())
})

test("demo size changes are retained as non-qualifying diagnostics", () => {
  assert.equal(demoDelta.comparisonStatus, "diagnostic-only-non-exact-runtime")
  assert.equal(demoDelta.counts.apps, apps.length)
  assert.equal(demoDelta.apps.length, apps.length)
})

test("size summaries are derived from raw/gzip/brotli case data", () => {
  for (const metric of ["raw", "gzip", "brotli"]) {
    const solid = results.examples.reduce((total, example) => total + example.solid[metric], 0)
    const solidlil = results.examples.reduce((total, example) => total + example.solidlil[metric], 0)
    assert.equal(solid, results.metrics[metric].solid)
    assert.equal(solidlil, results.metrics[metric].solidlil)
    assert.ok(Math.abs((1 - solidlil / solid) * 100 - results.metrics[metric].weightedReduction) < 1e-10)
  }
})

test("stale performance metrics are not mixed with current bundles", () => {
  assert.equal(results.performance, undefined)
  assert.equal(results.jsFrameworkBenchmark.status.cpu, "not-measured-for-current-artifacts")
  assert.equal(results.jsFrameworkBenchmark.status.memory, "not-measured-for-current-artifacts")
})

test("the keyed diagnostic is ineligible until the exact source port passes", async () => {
  const comparison = results.jsFrameworkBenchmark
  assert.equal(comparison.status.size, "diagnostic-only")
  assert.equal(comparison.eligibility.comparison, false)
  assert.equal(comparison.eligibility.exactSourcePort, false)
  assert.equal(comparison.status.cpu, "not-measured-for-current-artifacts")
  assert.equal(comparison.status.memory, "not-measured-for-current-artifacts")
  assert.deepEqual(comparison.cpu, [])
  assert.deepEqual(comparison.memory, [])
  assert.deepEqual(
    comparison.provenance.solid.postMinifier,
    comparison.provenance.solidlil.postMinifier,
  )
  assert.equal(comparison.provenance.solid.treeShaking, true)
  assert.equal(comparison.provenance.solidlil.treeShaking, true)
  assert.ok(
    comparison.diagnostics.solidWithoutTreeShaking.solid.brotli > comparison.sizes.solid.brotli,
  )
  assert.match(comparison.methodology.limitation, /does not attribute the full delta/i)

  const solidSource = await read("benchmarks/js-framework-benchmark/keyed/solid-v2/src/main.jsx")
  const solidlilSource = await read("benchmarks/js-framework-benchmark/keyed/solidlil/src/main.lilx")
  assert.match(solidSource, /setSelected\(0\)/)
  assert.match(solidlilSource, /selected\.write\(0\)/)
  assert.match(solidSource, /\.filter\(/)
  assert.match(solidlilSource, /\.filter\(/)
  assert.doesNotMatch(solidSource, /<For[^>]+keyed=/)
  assert.doesNotMatch(solidlilSource, /<For[^>]+keyed=/)
  assert.equal(upstreamPort.complete, false)
  assert.equal(upstreamPort.counts.total, 47)
  assert.equal(upstreamPort.counts.verified, 0)
})

test("the frozen compiler artifact remains available for before/after history", () => {
  const comparison = results.compilerComparison
  const before = comparison.runs.find((run) => run.role === "before")
  assert.equal(comparison.schemaVersion, 1)
  assert.equal(comparison.objective, "brotli11")
  assert.deepEqual(before.artifact.sizes, { raw: 8179, gzip9: 3250, brotli11: 2909 })
  assert.match(before.source.revision, /^[0-9a-f]{40}$/)
  assert.match(before.config.sha256, /^[0-9a-f]{64}$/)
  assert.match(before.artifact.sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(before.timing.samples, [])
})

test("every API used by the live recreations exists in solidlil", () => {
  for (const name of [
    "createSignal", "createMemo", "createEffect", "flush", "createRoot", "createStore",
    "action", "createOptimistic", "createOptimisticStore", "isPending", "latest", "lazy", "children",
    "createProjection", "reconcile", "mapArray", "createRevealOrder",
    "createOptimistic", "action", "latest", "isPending",
  ]) {
    assert.equal(typeof runtime[name], "function", `${name} is not callable`)
  }
})

test("the README leads with the exact-port gate", async () => {
  const readme = await read("README.md")
  const status = readme.indexOf("Exact-port status")
  const withdrawn = readme.indexOf("old comparison was withdrawn")
  const install = readme.indexOf("npm install @itslil/solidjs")
  assert.ok(status > 0 && status < withdrawn && withdrawn < install)
  assert.match(readme, /not yet an\s+exact or drop-in Solid implementation/)
  assert.match(readme, /47 browser-runtime source modules/)
  assert.match(readme, /https:\/\/yeargun\.github\.io\/solidlil\//)
})

test("the lab app script parses", () => {
  const checked = spawnSync(process.execPath, ["--check", join(root, "site", "app.js")], { encoding: "utf8" })
  assert.equal(checked.status, 0, checked.stderr)
})

test("the generated Pages artifact includes demos, sizes, and performance", async () => {
  for (const path of [
    "_site/index.html", "_site/app.js", "_site/compiler-comparison.js", "_site/styles.css", "_site/demo.css",
    "_site/results.json", "_site/upstream-port.json", "_site/demo-e2e.json", "_site/demo-size-delta.json", ".nojekyll",
  ]) {
    const target = path === ".nojekyll" ? "_site/.nojekyll" : path
    assert.ok((await stat(join(root, target))).size >= 0, `${path} is missing`)
  }
  const html = await read("_site/index.html")
  assert.match(html, /id="performance"/)
  assert.match(html, /id="perf-cards"/)
  assert.match(html, /Solid raw/)
  assert.match(html, /Lil brotli/)
  assert.match(html, /LSX/)
  assert.match(html, /@itslil\/solidjs/)
  assert.match(html, /js-framework-benchmark/)
  assert.match(html, /id="why"/)
  assert.match(html, /Exact before/)
  assert.match(html, /Behavior before bytes/)
  assert.match(html, /id="compiler-comparison"/)
  assert.match(html, /Same boundaries/)
  assert.match(html, /No façade credit/)
  assert.match(html, /data-filter="async"/)
  assert.match(html, /closed-world/)
  assert.doesNotMatch(html, /We never compiled SSR/)
  assert.doesNotMatch(html, /unused @solidjs\/signals/)
  assert.doesNotMatch(html, /ours <code>host\.lil<\/code>/)
  assert.ok(results.jsFrameworkBenchmark)
  assert.equal(results.jsFrameworkBenchmark.eligibility.comparison, false)
  assert.ok(results.jsFrameworkBenchmark.sizes.solid.brotli > results.jsFrameworkBenchmark.sizes.solidlil.brotli)
  assert.ok(
    results.jsFrameworkBenchmark.sizes.solid.brotli < 20000,
    "Solid JFB Brotli is the Vite app payload (~11 kB), not an export * vendor",
  )
  for (const app of apps) {
    assert.ok((await stat(join(root, "_site", "apps", app.id, "solid.html"))).size > 0)
    assert.ok((await stat(join(root, "_site", "apps", app.id, "solidlil.html"))).size > 0)
    assert.ok((await stat(join(root, "_site", "apps", app.id, "compare.html"))).size > 0)
  }
})

test("the compiler comparison renderer parses", () => {
  const checked = spawnSync(process.execPath, ["--check", join(root, "site", "compiler-comparison.js")], { encoding: "utf8" })
  assert.equal(checked.status, 0, checked.stderr)
})
