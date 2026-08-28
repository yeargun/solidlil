import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const lock = JSON.parse(await readFile(join(root, "upstream.lock.json"), "utf8"))
const strict = process.argv.includes("--strict")

function revision(checkout) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  }).trim()
}

const rows = []
for (const [repository, definition] of Object.entries({
  solid: lock.solid,
  "dom-expressions": lock.domExpressions,
})) {
  const checkout = resolve(root, definition.checkout)
  if (!existsSync(checkout)) {
    throw new Error(`missing local checkout ${checkout}`)
  }
  const actualRevision = revision(checkout)
  if (actualRevision !== definition.revision) {
    throw new Error(
      `${repository} checkout is ${actualRevision}; expected ${definition.revision}`,
    )
  }
  for (const source of definition.files) {
    const upstreamPath = resolve(checkout, source)
    if (!existsSync(upstreamPath)) throw new Error(`missing pinned source ${upstreamPath}`)
    const target = (repository === "solid"
      ? source.replace(/^packages\//, "")
      : source.replace(/^packages\/runtime\/src\//, "dom-expressions/runtime/"))
      .replace(/\.(?:ts|js)$/, ".lil")
    const localPath = resolve(root, "src", "upstream", target)
    rows.push({
      repository,
      source,
      sourceSha256: createHash("sha256")
        .update(await readFile(upstreamPath))
        .digest("hex"),
      target: relative(root, localPath),
      status:
        existsSync(localPath) && lock.verifiedFiles.includes(target)
          ? "verified"
          : existsSync(localPath)
            ? "unverified"
            : "missing",
    })
  }
}

const counts = Object.fromEntries(
  ["verified", "unverified", "missing"].map((status) => [
    status,
    rows.filter((row) => row.status === status).length,
  ]),
)
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  complete: counts.verified === rows.length,
  counts: { total: rows.length, ...counts },
  repositories: {
    solid: {
      revision: lock.solid.revision,
      checkout: lock.solid.checkout,
    },
    "dom-expressions": {
      revision: lock.domExpressions.revision,
      checkout: lock.domExpressions.checkout,
    },
  },
  rule:
    "Every upstream browser-runtime source file needs a matching typed .lil module and upstream differential tests before size comparisons are eligible.",
  files: rows,
}

await writeFile(join(root, "site", "upstream-port.json"), `${JSON.stringify(report, null, 2)}\n`)
console.log(
  `Exact upstream port: ${counts.verified}/${rows.length} verified; ${counts.unverified} unverified; ${counts.missing} missing.`,
)
if (strict && !report.complete) process.exitCode = 1
