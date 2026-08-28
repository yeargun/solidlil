import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import solidPlugin from "@solidjs/vite-plugin"
import { minify } from "terser"
import { build } from "vite"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(root, "dist")
const artifacts = join(root, "artifacts")
const entry = join(root, "src", "main.jsx")
const packageDefinition = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
const terserOptions = {
  module: true,
  compress: { passes: 3 },
  mangle: { toplevel: true },
  format: { comments: false },
}

async function bundle({ format = "es", minify, treeshake }) {
  const built = await build({
    configFile: false,
    root,
    logLevel: "error",
    plugins: [solidPlugin()],
    build: {
      target: "es2022",
      minify,
      write: false,
      lib: { entry, name: "App", formats: [format], fileName: "main" },
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
        treeshake,
      },
    },
  })
  const outputs = Array.isArray(built) ? built.flatMap((item) => item.output) : built.output
  const chunks = outputs.filter((item) => item.type === "chunk")
  if (chunks.length !== 1) throw new Error(`expected one JavaScript chunk, received ${chunks.length}`)
  return chunks[0]
}

async function terser(code, properties = false) {
  const result = await minify(code, {
    ...terserOptions,
    mangle: properties
      ? { ...terserOptions.mangle, properties: { regex: /^_/, keep_quoted: true } }
      : terserOptions.mangle,
  })
  if (!result.code) throw new Error("Terser produced no code")
  return `${result.code}\n`
}

const shaken = await bundle({ minify: false, treeshake: true })
const native = `${(await bundle({ format: "iife", minify: "oxc", treeshake: true })).code.trim()}\n`
const code = await terser(shaken.code)
const privateProperties = await terser(shaken.code, true)
const noTreeShaking = await terser((await bundle({ minify: false, treeshake: false })).code)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await mkdir(artifacts, { recursive: true })
await writeFile(join(dist, "main.js"), code)
await writeFile(join(artifacts, "native.js"), native)
await writeFile(join(artifacts, "private-properties.js"), privateProperties)
await writeFile(join(artifacts, "no-tree-shaking.js"), noTreeShaking)
await writeFile(
  join(dist, "build-meta.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      implementation: "solid-v2",
      workloadContract: "jfb-keyed-v2-object-identity",
      target: "es2022",
      moduleFormat: "esm",
      frontend: {
        name: "@solidjs/vite-plugin",
        version: packageDefinition.devDependencies["@solidjs/vite-plugin"],
      },
      bundler: { name: "vite", version: packageDefinition.devDependencies.vite },
      postMinifier: {
        name: "terser",
        version: packageDefinition.devDependencies.terser,
        compressPasses: 3,
        toplevelMangling: true,
        propertyMangling: false,
      },
      treeShaking: true,
      retainedModules: Object.fromEntries(
        Object.entries(shaken.modules).map(([id, value]) => [
          id.replace(`${root}/`, ""),
          value.renderedLength,
        ]),
      ),
      sourceSha256: createHash("sha256").update(await readFile(entry)).digest("hex"),
      artifactSha256: createHash("sha256").update(code).digest("hex"),
    },
    null,
    2,
  )}\n`,
)
console.log(`built ${join(dist, "main.js")} (${Buffer.byteLength(code)} bytes)`)
