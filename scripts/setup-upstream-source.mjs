import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const lock = JSON.parse(await readFile(resolve(root, "upstream.lock.json"), "utf8"))

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed`)
  }
  return result.stdout.trim()
}

mkdirSync(resolve(root, "upstream"), { recursive: true })
for (const definition of [lock.solid, lock.domExpressions]) {
  const checkout = resolve(root, definition.checkout)
  if (!existsSync(resolve(checkout, ".git"))) {
    run("git", ["clone", "--filter=blob:none", "--no-checkout", definition.repository, checkout])
  }
  if (run("git", ["status", "--porcelain"], checkout)) {
    throw new Error(`refusing to replace modified upstream checkout ${checkout}`)
  }
  run("git", ["fetch", "--depth=1", "origin", definition.revision], checkout)
  run("git", ["checkout", "--detach", definition.revision], checkout)
  console.log(`${definition.repository} -> ${definition.revision}`)
}
