import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const benchmark = join(root, "benchmarks", "js-framework-benchmark", "keyed")
const implementations = {
  solid: join(benchmark, "solid-v2"),
  solidlil: join(benchmark, "solidlil"),
}
const codecCandidates = [
  process.env.SOLIDLIL_CODEC,
  resolve(root, "../lilscript/target/release/lilscript-codec"),
  "lilscript-codec",
].filter(Boolean)
const codec = codecCandidates.find((candidate) => {
  if (candidate.includes("/") && !existsSync(candidate)) return false
  return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0
})
if (!codec) throw new Error("lilscript-codec not found; set SOLIDLIL_CODEC")

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"))
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex")
const metadata = Object.fromEntries(
  await Promise.all(
    Object.entries(implementations).map(async ([id, directory]) => [
      id,
      await readJson(join(directory, "dist", "build-meta.json")),
    ]),
  ),
)

assert.equal(metadata.solid.workloadContract, metadata.solidlil.workloadContract)
assert.equal(metadata.solid.target, metadata.solidlil.target)
assert.equal(metadata.solid.moduleFormat, metadata.solidlil.moduleFormat)
assert.deepEqual(metadata.solid.postMinifier, metadata.solidlil.postMinifier)

const paths = {
  solid: {
    canonical: join(implementations.solid, "dist", "main.js"),
    native: join(implementations.solid, "artifacts", "native.js"),
    privateProperties: join(implementations.solid, "artifacts", "private-properties.js"),
    noTreeShaking: join(implementations.solid, "artifacts", "no-tree-shaking.js"),
  },
  solidlil: {
    canonical: join(implementations.solidlil, "dist", "main.js"),
    native: join(implementations.solidlil, "artifacts", "native.js"),
    privateProperties: join(implementations.solidlil, "artifacts", "private-properties.js"),
  },
}
const ordered = Object.values(paths).flatMap((group) => Object.values(group))
const packageCore = join(root, "dist", "core.js")
ordered.push(packageCore)
const measured = JSON.parse(execFileSync(codec, ["--json", ...ordered], { encoding: "utf8" }))
const measurements = new Map(measured.artifacts.map((artifact) => [resolve(artifact.path), artifact]))
const sizes = (path) => {
  const value = measurements.get(resolve(path))
  assert.ok(value, `missing codec result for ${path}`)
  return { raw: value.raw, gzip: value.gzip9, brotli: value.brotli11 }
}

for (const [id, directory] of Object.entries(implementations)) {
  assert.equal(
    metadata[id].artifactSha256,
    await sha256(join(directory, "dist", "main.js")),
    `${id} artifact hash`,
  )
}

const resultsPath = join(root, "site", "results.json")
const site = await readJson(resultsPath)
delete site.performance
site.jsFrameworkBenchmark = {
  status: {
    size: "current",
    cpu: "not-measured-for-current-artifacts",
    memory: "not-measured-for-current-artifacts",
  },
  generatedAt: new Date().toISOString(),
  source: "https://github.com/krausest/js-framework-benchmark",
  workloadContract: metadata.solid.workloadContract,
  methodology: {
    claim: "equivalent keyed application output, not isolated library size",
    source:
      "Both implementations use object-identity keyed rows, identical random data generation, selection reset, Array.filter removal, and matching visible text.",
    treeShaking:
      "Enabled in both production lanes. Solid uses Vite module tree shaking; SolidLil uses LilScript whole-program dead-code elimination.",
    finalMinifier:
      "Both canonical artifacts use Terser 5.43.1, three compression passes, top-level identifier mangling, and no property mangling.",
    limitation:
      "This compares complete application toolchains and runtime implementations. It does not attribute the full delta to the LilScript compressor alone.",
  },
  provenance: {
    solid: metadata.solid,
    solidlil: metadata.solidlil,
    codec: {
      path: relative(root, codec),
      sha256: await sha256(codec),
      ...measured.codecs,
    },
  },
  sizes: {
    solid: sizes(paths.solid.canonical),
    solidlil: sizes(paths.solidlil.canonical),
  },
  diagnostics: {
    nativeProduction: {
      description: "Each frontend's native production output: Vite/Oxc for Solid and LilScript without the shared Terser pass.",
      solid: sizes(paths.solid.native),
      solidlil: sizes(paths.solidlil.native),
    },
    sharedPrivatePropertyMangle: {
      description: "The canonical input on both sides with the same additional /^_/ property-mangle rule.",
      solid: sizes(paths.solid.privateProperties),
      solidlil: sizes(paths.solidlil.privateProperties),
    },
    solidWithoutTreeShaking: {
      description: "Solid-only diagnostic built from the same entry with Vite tree shaking disabled, then the canonical Terser pass.",
      solid: sizes(paths.solid.noTreeShaking),
    },
    solidRetainedModules: metadata.solid.retainedModules,
  },
  geomean: { cpu: null },
  cpu: [],
  memory: [],
}
const previousCompilerRuns = (site.compilerComparison?.runs ?? []).filter(
  (run) => run.role !== "current",
)
const compilerRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: resolve(root, "../lilscript"),
  encoding: "utf8",
}).trim()
site.compilerComparison = {
  schemaVersion: 1,
  objective: "brotli11",
  runs: [
    ...previousCompilerRuns,
    {
      id: `current-${metadata.solidlil.frontend.binarySha256.slice(0, 12)}`,
      role: "current",
      label: "Current compiler · rebuilt packaged core",
      recordedAt: new Date().toISOString(),
      source: {
        revision: metadata.solidlil.source.revision,
        tree: metadata.solidlil.source.dirty ? null : metadata.solidlil.source.revision,
        entrySha256: await sha256(join(root, "src", "entries", "core.lil")),
        packageLockSha256: await sha256(join(root, "package-lock.json")),
      },
      config: {
        path: "src/lilscript.toml",
        sha256: await sha256(join(root, "src", "lilscript.toml")),
        derivation: { kind: "identity" },
      },
      compiler: {
        revision: metadata.solidlil.frontend.revision ?? compilerRevision,
        binarySha256: metadata.solidlil.frontend.binarySha256,
        dirty: metadata.solidlil.frontend.dirty,
      },
      codec: {
        binarySha256: await sha256(codec),
        gzipLevel: 9,
        brotliQuality: 11,
      },
      artifact: {
        path: "dist/core.js",
        sha256: await sha256(packageCore),
        sizes: {
          raw: sizes(packageCore).raw,
          gzip9: sizes(packageCore).gzip,
          brotli11: sizes(packageCore).brotli,
        },
      },
      timing: {
        scope: "compile",
        samples: [],
        unavailableReason: "build timing was not isolated from the package build",
      },
      semantic: {
        status: "build-passed",
        command: "npm run build",
        summary: "the current compiler rebuilt every published package entry",
      },
    },
  ],
}

await writeFile(resultsPath, `${JSON.stringify(site, null, 2)}\n`)
console.log(JSON.stringify(site.jsFrameworkBenchmark, null, 2))
