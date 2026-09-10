import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { minify } from "terser"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "src")
const dist = join(root, "dist")
const compilerCandidates = [
  process.env.SOLIDLIL_LILSCRIPT_BIN,
  resolve(root, "../lilscript/target/release/lilscript"),
  "lilscript",
].filter(Boolean)
const compiler = compilerCandidates.find((candidate) => {
  if (candidate.includes("/") && !existsSync(candidate)) return false
  return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0
})
const buildMode = process.env.SOLIDLIL_BUILD_MODE ?? "production"
if (!compiler) {
  throw new Error("LilScript compiler not found. Set SOLIDLIL_LILSCRIPT_BIN to a release compiler.")
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const temps = []

function compile(name, input) {
  const compiled = join(source, `.__compiled-${name}.mjs`)
  temps.push(compiled)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      compiler,
      [join(source, input), "--target", "js-module", "--config", join(source, "lilscript.toml"), "--mode", buildMode, "--output", compiled],
      { cwd: root },
    )
    let output = ""
    child.stdout.on("data", (chunk) => { output += chunk })
    // The compiler writes its `lilscript-timing` line to stderr under
    // LILSCRIPT_TIMING=1, and the build pool reads that line as proof a
    // compile really happened -- a build that exits 0 without one is
    // reported as failed, so its dist is never copied back. Buffering
    // stderr for the error path is right; swallowing it on success is not.
    child.stderr.on("data", (chunk) => { output += chunk; process.stderr.write(chunk) })
    child.on("error", reject)
    child.on("close", (status) => {
      if (status !== 0) reject(new Error(output || `${name} failed`))
      else resolvePromise(compiled)
    })
  })
}

async function terserMinify(file, module) {
  if (buildMode !== "production") return
  const result = await minify(await readFile(file, "utf8"), {
    module,
    compress: { passes: 3 },
    mangle: { toplevel: true, properties: { regex: /^_/, keep_quoted: true } },
    format: { comments: false },
  })
  if (!result.code) throw new Error(`Terser produced no code for ${file}`)
  await writeFile(file, `${result.code}\n`)
}

async function emitBundled(entry, outfile, format, platform = "browser") {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform,
    format,
    target: "es2020",
    treeShaking: false,
    legalComments: "none",
    logLevel: "warning",
    outfile,
    ...(format === "iife" ? { globalName: "solidlil" } : {}),
  })
  await terserMinify(outfile, format === "esm")
}

function rewrite(sourceText) {
  return sourceText
    .replaceAll("./.__compiled-core.mjs", "./core.js")
    .replaceAll("./compat.mjs", "./compat.js")
    .replaceAll("./solid-api.mjs", "./solid-api.js")
    .replaceAll("./lil-web.js", "./lil-web.js")
}

try {
  const core = await compile("core", "entries/core.lil")
  const web = await compile("web", "web.lil")
  const full = await compile("full", "entries/full.lil")
  await emitBundled(core, join(dist, "core.js"), "esm")
  await emitBundled(core, join(dist, "core.cjs"), "cjs", "neutral")
  await emitBundled(web, join(dist, "lil-web.js"), "esm")
  await emitBundled(web, join(dist, "lil-web.cjs"), "cjs", "neutral")
  await emitBundled(full, join(dist, "full.js"), "esm")
  await emitBundled(full, join(dist, "full.cjs"), "cjs", "neutral")
  await emitBundled(full, join(dist, "solidlil.global.js"), "iife")

  const compatSource = rewrite(await readFile(join(source, "compat.mjs"), "utf8"))
  await writeFile(join(dist, "compat.js"), compatSource)
  await writeFile(join(dist, "solid-api.js"), rewrite(await readFile(join(source, "solid-api.mjs"), "utf8")))
  await writeFile(join(dist, "dom-tables.js"), await readFile(join(source, "dom-tables.mjs"), "utf8"))
  await writeFile(
    join(dist, "web-api.js"),
    (await readFile(join(source, "web-api.mjs"), "utf8"))
      .replaceAll("./solid-api.mjs", "./solid-api.js")
      .replaceAll("./dom-tables.mjs", "./dom-tables.js")
      .replaceAll("./lil-web.js", "./lil-web.js"),
  )

  await emitBundled(join(dist, "solid-api.js"), join(dist, "index.js"), "esm")
  await emitBundled(join(dist, "solid-api.js"), join(dist, "index.cjs"), "cjs", "neutral")
  await emitBundled(join(dist, "solid-api.js"), join(dist, "index.bundle.js"), "esm")
  await emitBundled(join(dist, "web-api.js"), join(dist, "web.js"), "esm")
  await emitBundled(join(dist, "web-api.js"), join(dist, "web.cjs"), "cjs", "neutral")
} finally {
  await Promise.all(temps.map((file) => rm(file, { force: true })))
}

console.log(`Built solidlil ${buildMode} entries with ${compiler}`)
