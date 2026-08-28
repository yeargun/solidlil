import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { minify } from "terser"
import { build as viteBuild } from "vite"
import { apps } from "./apps.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const compilerCandidates = [
  process.env.SOLIDLIL_LILSCRIPT_BIN,
  resolve(root, "../lilscript/target/release/lilscript"),
  "lilscript",
].filter(Boolean)
const compiler = compilerCandidates.find((candidate) => {
  if (candidate.includes("/") && !existsSync(candidate)) return false
  return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0
})
if (!compiler) throw new Error("LilScript compiler not found")

const distApps = join(root, "dist", "apps")
const siteApps = join(root, "site", "apps")
await rm(distApps, { recursive: true, force: true })
await rm(siteApps, { recursive: true, force: true })
await mkdir(distApps, { recursive: true })
await mkdir(siteApps, { recursive: true })
await copyFile(join(root, "site", "demo.css"), join(root, "dist", "demo.css"))

function bytesOf(source) {
  const input = Buffer.isBuffer(source) ? source : Buffer.from(source)
  return {
    raw: input.length,
    gzip: gzipSync(input, { level: 9 }).length,
    brotli: brotliCompressSync(input, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  }
}

async function compileLil(id) {
  const { compileLilxFile } = await import("../tooling/lilx/compile.mjs")
  const entry = join(root, "apps", id, "solidlil", "main.lilx")
  const generated = join(root, "apps", id, "solidlil", ".generated.lil")
  compileLilxFile(entry, generated, {
    filename: entry,
    reactiveImport: "../../../src/reactive",
    storeImport: "../../../src/store",
    domImport: "../../../src/lsx",
    asyncImport: "../../../src/async",
  })
  const out = join(distApps, id, "solidlil.js")
  await mkdir(join(distApps, id), { recursive: true })
  const result = spawnSync(
    compiler,
    [generated, "--target", "js-module", "--config", join(root, "src", "lilscript.closed.toml"), "--mode", "production", "--output", out],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
  if (result.status !== 0) {
    throw new Error(`${id} lil compile failed\n${result.stderr || result.stdout}\n(generated ${generated})`)
  }
  await rm(generated, { force: true })
  const minified = await minify(await readFile(out, "utf8"), {
    module: true,
    compress: { passes: 3 },
    mangle: { toplevel: true, properties: { regex: /^_/, keep_quoted: true } },
    format: { comments: false },
  })
  const code = inlineAsyncHost(minified.code)
  await writeFile(out, `${code}\n`)
  return bytesOf(code)
}

function inlineAsyncHost(code) {
  return code.replace(
    /import\s*\{([^}]+)\}\s*from\s*["'][^"']*async-host\.js["'];?/,
    (_, specifiers) => {
      const local = specifiers.includes(" as ")
        ? specifiers.split(" as ").pop().trim()
        : specifiers.trim()
      return `function ${local}(value,ms){return new Promise((resolve)=>setTimeout(()=>resolve(value),ms))}`
    },
  )
}

async function compileKeyedPerformance() {
  const { compileLilxFile } = await import("../tooling/lilx/compile.mjs")
  const entry = join(root, "apps", "keyed", "solidlil", "main.lilx")
  const generated = join(root, "apps", "keyed", "solidlil", ".generated.performance.lil")
  compileLilxFile(entry, generated, {
    filename: entry,
    reactiveImport: "../../../src/reactive",
    storeImport: "../../../src/store",
    domImport: "../../../src/lsx",
    asyncImport: "../../../src/async",
  })
  const out = join(distApps, "keyed", "solidlil.performance.js")
  const result = spawnSync(
    compiler,
    [generated, "--target", "js-module", "--config", join(root, "src", "lilscript.closed.toml"), "--mode", "production", "--output", out],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
  if (result.status !== 0) {
    throw new Error(`keyed performance compile failed\n${result.stderr || result.stdout}`)
  }
  await rm(generated, { force: true })
  if (result.status !== 0) {
    throw new Error(`keyed performance compile failed\n${result.stderr || result.stdout}`)
  }
  const minified = await minify(await readFile(out, "utf8"), {
    module: true,
    compress: { passes: 3 },
    mangle: { toplevel: true },
    format: { comments: false },
  })
  await writeFile(out, `${minified.code}\n`)
  return bytesOf(minified.code)
}

function html(src) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>solidlil demo</title>
    <link rel="stylesheet" href="../../demo.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="${src}"></script>
  </body>
</html>
`
}

function metricTotals(key) {
  const solid = results.reduce((sum, row) => sum + row.solid[key], 0)
  const solidlil = results.reduce((sum, row) => sum + row.solidlil[key], 0)
  const reductions = results.map((row) => (1 - row.solidlil[key] / row.solid[key]) * 100).sort((a, b) => a - b)
  return {
    solid,
    solidlil,
    weightedReduction: (1 - solidlil / solid) * 100,
    medianReduction: reductions[Math.floor(reductions.length / 2)],
    minimumReduction: reductions[0],
    maximumReduction: reductions[reductions.length - 1],
    wins: results.filter((row) => row.solidlil[key] < row.solid[key]).length,
  }
}

const solidPluginModule = await import("@solidjs/vite-plugin")
const solidPlugin = typeof solidPluginModule.default === "function"
  ? solidPluginModule.default
  : solidPluginModule.solidPlugin ?? Object.values(solidPluginModule).find((value) => typeof value === "function")

const results = []
for (const app of apps) {
  console.log(`building ${app.id}`)
  const lil = await compileLil(app.id)
  const solidDir = join(distApps, app.id)
  const solidEntry = [
    join(root, "apps", app.id, "solid", "main.tsx"),
    join(root, "apps", app.id, "solid", "main.jsx"),
  ].find((candidate) => existsSync(candidate))
  if (!solidEntry) throw new Error(`${app.id} is missing apps/${app.id}/solid/main.tsx or main.jsx`)
  await viteBuild({
    configFile: false,
    root,
    build: {
      outDir: join(solidDir, "solid-out"),
      emptyOutDir: true,
      minify: "oxc",
      cssCodeSplit: false,
      rollupOptions: {
        input: solidEntry,
        output: {
          entryFileNames: "solid.js",
          chunkFileNames: "solid-[name].js",
          assetFileNames: "solid-[name][extname]",
          format: "es",
        },
        treeshake: {
          moduleSideEffects: false,
          propertyReadSideEffects: false,
        },
      },
    },
    plugins: [solidPlugin()],
    logLevel: "warn",
  })
  const solidCode = await readFile(join(solidDir, "solid-out", "solid.js"), "utf8")
  await writeFile(join(solidDir, "solid.js"), solidCode)
  await rm(join(solidDir, "solid-out"), { recursive: true, force: true })
  const solid = bytesOf(solidCode)
  await writeFile(join(solidDir, "solid.html"), html("./solid.js"))
  await writeFile(join(solidDir, "solidlil.html"), html("./solidlil.js"))
  await writeFile(
    join(solidDir, "compare.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${app.title}</title>
    <link rel="stylesheet" href="../../demo.css" />
    <style>
      body { margin: 0; }
      .pair { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
      .lane { border-right: 1px solid #d5deea; }
      .lane header { padding: 10px 14px; font: 700 12px/1.2 ui-monospace, monospace; text-transform: uppercase; }
      iframe { width: 100%; height: calc(100vh - 38px); border: 0; }
    </style>
  </head>
  <body>
    <div class="pair">
      <div class="lane">
        <header>Solid 2.0 · ${solid.raw}/${solid.gzip}/${solid.brotli} B raw/gzip/brotli</header>
        <iframe src="./solid.html" title="Solid 2.0 ${app.title}"></iframe>
      </div>
      <div class="lane">
        <header>solidlil · ${lil.raw}/${lil.gzip}/${lil.brotli} B raw/gzip/brotli</header>
        <iframe src="./solidlil.html" title="solidlil ${app.title}"></iframe>
      </div>
    </div>
  </body>
</html>
`,
  )
  await cp(solidDir, join(siteApps, app.id), { recursive: true })
  results.push({
    ...app,
    solid,
    solidlil: lil,
    reduction: {
      raw: (1 - lil.raw / solid.raw) * 100,
      gzip: (1 - lil.gzip / solid.gzip) * 100,
      brotli: (1 - lil.brotli / solid.brotli) * 100,
    },
  })
}

const keyedPerf = await compileKeyedPerformance()
await writeFile(join(distApps, "keyed", "solidlil.performance.html"), html("./solidlil.performance.js"))
await copyFile(join(distApps, "keyed", "solidlil.performance.js"), join(siteApps, "keyed", "solidlil.performance.js"))
await copyFile(join(distApps, "keyed", "solidlil.performance.html"), join(siteApps, "keyed", "solidlil.performance.html"))

const artifacts = {}
for (const name of ["core", "web", "full", "index.bundle"]) {
  const file = join(root, "dist", `${name}.js`)
  if (existsSync(file)) artifacts[name] = bytesOf(await readFile(file))
}

const previousResults = join(root, "site", "results.json")
const previous = existsSync(previousResults)
  ? JSON.parse(await readFile(previousResults, "utf8"))
  : null

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  compression: { gzip: 9, brotli: 11 },
  solid: "solid-js@2.0.0-rc.0 + @solidjs/web@2.0.0-rc.0",
  solidlil: "compatibility-prototype demos; exact runtime comparison is ineligible",
  cases: results.length,
  metrics: {
    raw: metricTotals("raw"),
    gzip: metricTotals("gzip"),
    brotli: metricTotals("brotli"),
  },
  keyedPerformance: keyedPerf,
  artifacts,
  examples: results,
  ...(previous?.jsFrameworkBenchmark ? { jsFrameworkBenchmark: previous.jsFrameworkBenchmark } : {}),
  ...(previous?.compilerComparison ? { compilerComparison: previous.compilerComparison } : {}),
}

await writeFile(join(root, "site", "results.json"), JSON.stringify(summary, null, 2) + "\n")
await writeFile(join(distApps, "results.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify({
  cases: summary.cases,
  wins: summary.metrics.brotli.wins,
  brotli: summary.metrics.brotli,
}, null, 2))
