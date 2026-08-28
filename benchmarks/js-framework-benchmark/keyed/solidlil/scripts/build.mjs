import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { minify } from "terser"

const frameworkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function findSolidlilRoot(start) {
  if (process.env.SOLIDLIL_ROOT) return resolve(process.env.SOLIDLIL_ROOT)
  let current = resolve(start)
  while (true) {
    if (
      existsSync(join(current, "src", "reactive.lil")) &&
      existsSync(join(current, "src", "lsx.lil")) &&
      existsSync(join(current, "tooling", "lilx", "compile.mjs"))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      throw new Error("solidlil root not found; set SOLIDLIL_ROOT")
    }
    current = parent
  }
}

const solidlilRoot = findSolidlilRoot(frameworkRoot)
const compilerCandidates = [
  process.env.SOLIDLIL_LILSCRIPT_BIN,
  join(solidlilRoot, "../lilscript/target/release/lilscript"),
  "lilscript",
].filter(Boolean)
const compiler = compilerCandidates.find((candidate) => {
  if (candidate.includes("/") && !existsSync(candidate)) return false
  return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0
})
if (!compiler) throw new Error("LilScript compiler not found")
const packageDefinition = JSON.parse(await readFile(join(frameworkRoot, "package.json"), "utf8"))
const terserOptions = {
  module: true,
  compress: { passes: 3 },
  mangle: { toplevel: true },
  format: { comments: false },
}

function lilImport(fromFile, target) {
  let value = relative(dirname(fromFile), target).replaceAll("\\", "/")
  if (!value.startsWith(".")) value = `./${value}`
  return value
}

const { compileLilxFile } = await import(
  `file://${join(solidlilRoot, "tooling", "lilx", "compile.mjs")}`
)

const entry = join(frameworkRoot, "src", "main.lilx")
const generated = join(frameworkRoot, "src", ".generated.lil")
compileLilxFile(entry, generated, {
  filename: entry,
  reactiveImport: lilImport(generated, join(solidlilRoot, "src", "reactive")),
  storeImport: lilImport(generated, join(solidlilRoot, "src", "store")),
  domImport: lilImport(generated, join(solidlilRoot, "src", "lsx")),
  asyncImport: lilImport(generated, join(solidlilRoot, "src", "async")),
})

const dist = join(frameworkRoot, "dist")
const artifacts = join(frameworkRoot, "artifacts")
await mkdir(dist, { recursive: true })
await mkdir(artifacts, { recursive: true })
const out = join(dist, "main.js")
const result = spawnSync(
  compiler,
  [
    generated,
    "--target",
    "js-module",
    "--config",
    join(solidlilRoot, "src", "lilscript.closed.toml"),
    "--mode",
    "production",
    "--output",
    out,
  ],
  { cwd: solidlilRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
)
await rm(generated, { force: true })
if (result.status !== 0) {
  throw new Error(`solidlil jsfb compile failed\n${result.stderr || result.stdout}`)
}

const native = `${(await readFile(out, "utf8")).trim()}\n`
await writeFile(join(artifacts, "native.js"), native)
const minified = await minify(native, terserOptions)
if (!minified.code) throw new Error("Terser produced no code")
const code = `${minified.code}\n`
await writeFile(out, code)
const privateMinified = await minify(native, {
  ...terserOptions,
  mangle: {
    ...terserOptions.mangle,
    properties: { regex: /^_/, keep_quoted: true },
  },
})
if (!privateMinified.code) throw new Error("Terser property-mangle lane produced no code")
await writeFile(join(artifacts, "private-properties.js"), `${privateMinified.code}\n`)
const commandOutput = (command, args, cwd) => {
  const value = spawnSync(command, args, { cwd, encoding: "utf8" })
  return value.status === 0 ? value.stdout.trim() : null
}
const compilerRoot = commandOutput("git", ["rev-parse", "--show-toplevel"], dirname(compiler))
await writeFile(
  join(dist, "build-meta.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      implementation: "solidlil-v2",
      workloadContract: "jfb-keyed-v2-object-identity",
      target: "es2022",
      moduleFormat: "esm",
      frontend: {
        name: "lilscript",
        version: commandOutput(compiler, ["--version"], solidlilRoot),
        binarySha256: createHash("sha256").update(await readFile(compiler)).digest("hex"),
        revision: compilerRoot
          ? commandOutput("git", ["rev-parse", "HEAD"], compilerRoot)
          : null,
        dirty: compilerRoot
          ? Boolean(commandOutput("git", ["status", "--porcelain"], compilerRoot))
          : null,
      },
      source: {
        revision: commandOutput("git", ["rev-parse", "HEAD"], solidlilRoot),
        dirty: Boolean(commandOutput("git", ["status", "--porcelain"], solidlilRoot)),
      },
      bundler: { name: "lilscript", mode: "single" },
      postMinifier: {
        name: "terser",
        version: packageDefinition.devDependencies.terser,
        compressPasses: 3,
        toplevelMangling: true,
        propertyMangling: false,
      },
      treeShaking: true,
      sourceSha256: createHash("sha256").update(await readFile(entry)).digest("hex"),
      artifactSha256: createHash("sha256").update(code).digest("hex"),
    },
    null,
    2,
  )}\n`,
)
console.log(`built ${out} (${Buffer.byteLength(code)} bytes)`)
