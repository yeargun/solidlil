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

test("size summaries are derived from raw/gzip/brotli case data", () => {
  for (const metric of ["raw", "gzip", "brotli"]) {
    const solid = results.examples.reduce((total, example) => total + example.solid[metric], 0)
    const solidlil = results.examples.reduce((total, example) => total + example.solidlil[metric], 0)
    assert.equal(solid, results.metrics[metric].solid)
    assert.equal(solidlil, results.metrics[metric].solidlil)
    assert.ok(Math.abs((1 - solidlil / solid) * 100 - results.metrics[metric].weightedReduction) < 1e-10)
  }
})

test("performance metrics are published next to the size tables", () => {
  assert.ok(results.performance)
  assert.ok(results.performance.nodeMs.solidlil.signal50k > 0)
  assert.ok(results.performance.nodeMs.solidlil.memo50k > 0)
  assert.ok(results.performance.nodeMs.solidlil.effect10k > 0)
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

test("the README leads with size and performance evidence", async () => {
  const readme = await read("README.md")
  const jfb = readme.indexOf("js-framework-benchmark")
  const evidence = readme.indexOf("paired browser demos")
  const install = readme.indexOf("npm install @itslil/solidjs")
  assert.ok(jfb > 0 && jfb < evidence && evidence < install)
  assert.match(readme, /## Why smaller/)
  assert.match(readme, /Same flush, same pending/)
  assert.doesNotMatch(readme, /We did not port Solid/)
  assert.match(readme, /raw \/ gzip-9 \/ Brotli-11/)
  assert.match(readme, /https:\/\/yeargun\.github\.io\/solidlil\//)
})

test("the lab app script parses", () => {
  const checked = spawnSync(process.execPath, ["--check", join(root, "site", "app.js")], { encoding: "utf8" })
  assert.equal(checked.status, 0, checked.stderr)
})

test("the generated Pages artifact includes demos, sizes, and performance", async () => {
  for (const path of [
    "_site/index.html", "_site/app.js", "_site/compiler-comparison.js", "_site/styles.css", "_site/demo.css",
    "_site/results.json", ".nojekyll",
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
  assert.match(html, /Why smaller/)
  assert.match(html, /Same flush, same pending/)
  assert.match(html, /id="compiler-comparison"/)
  assert.match(html, /Tree-shaking is the fair size/)
  assert.match(html, /Owned fields become slots/)
  assert.match(html, /data-filter="async"/)
  assert.match(html, /closed-world/)
  assert.doesNotMatch(html, /We never compiled SSR/)
  assert.doesNotMatch(html, /unused @solidjs\/signals/)
  assert.doesNotMatch(html, /ours <code>host\.lil<\/code>/)
  assert.ok(results.jsFrameworkBenchmark)
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
