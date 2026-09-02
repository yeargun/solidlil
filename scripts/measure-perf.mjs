import { createServer } from "node:http"
import { createRoot as lilRoot, createIntMemo, createIntSignal, createEffect, flush, signalGet, signalSet } from "../dist/core.js"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ITER = 50_000
const EFFECT_ITER = 10_000

function time(fn) {
  const start = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - start) / 1e6
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function ratio(lil, solid) {
  if (solid == null || solid === 0) return null
  return lil / solid
}

const nodeLil = {
  signal50k: time(() => {
    lilRoot(() => {
      const signal = createIntSignal(0)
      for (let i = 0; i < ITER; i++) {
        signalSet(signal, i)
        flush()
        signalGet(signal)
      }
    })
  }),
  memo50k: time(() => {
    lilRoot(() => {
      const source = createIntSignal(0)
      const memo = createIntMemo(() => signalGet(source) * 2)
      for (let i = 0; i < ITER; i++) {
        signalSet(source, i)
        flush()
        signalGet(memo)
      }
    })
  }),
  effect10k: time(() => {
    lilRoot(() => {
      const source = createIntSignal(0)
      let seen = 0
      createEffect(() => signalGet(source), (value) => { seen = value })
      flush()
      for (let i = 0; i < EFFECT_ITER; i++) {
        signalSet(source, i)
        flush()
      }
      if (seen !== EFFECT_ITER - 1) throw new Error("solidlil effect did not settle")
    })
  }),
}

let nodeSolid = null
try {
  const solidjs = await import("@solidjs/signals")
  nodeSolid = {
    signal50k: time(() => {
      solidjs.createRoot(() => {
        const [count, setCount] = solidjs.createSignal(0)
        for (let i = 0; i < ITER; i++) {
          setCount(i)
          solidjs.flush()
          count()
        }
      })
    }),
    memo50k: time(() => {
      solidjs.createRoot(() => {
        const [count, setCount] = solidjs.createSignal(0)
        const doubled = solidjs.createMemo(() => count() * 2)
        for (let i = 0; i < ITER; i++) {
          setCount(i)
          solidjs.flush()
          doubled()
        }
      })
    }),
    effect10k: time(() => {
      solidjs.createRoot(() => {
        const [count, setCount] = solidjs.createSignal(0)
        let seen = 0
        solidjs.createEffect(() => count(), (value) => { seen = value })
        solidjs.flush()
        for (let i = 0; i < EFFECT_ITER; i++) {
          setCount(i)
          solidjs.flush()
        }
        if (seen !== EFFECT_ITER - 1) throw new Error("solid-js effect did not settle")
      })
    }),
  }
} catch (error) {
  nodeSolid = { error: String(error) }
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  iterations: { signal: ITER, memo: ITER, effect: EFFECT_ITER },
  nodeMs: {
    solidlil: nodeLil,
    solid: nodeSolid,
    ratio: nodeSolid && !nodeSolid.error
      ? {
          signal50k: ratio(nodeLil.signal50k, nodeSolid.signal50k),
          memo50k: ratio(nodeLil.memo50k, nodeSolid.memo50k),
          effect10k: ratio(nodeLil.effect10k, nodeSolid.effect10k),
        }
      : null,
  },
}

async function mergeIntoResults() {
  const resultsPath = join(root, "site", "results.json")
  try {
    const results = JSON.parse(await readFile(resultsPath, "utf8"))
    results.performance = report
    await writeFile(resultsPath, JSON.stringify(results, null, 2) + "\n")
    await writeFile(join(root, "site", "perf.json"), JSON.stringify(report, null, 2) + "\n")
  } catch {
    await writeFile(join(root, "site", "perf.json"), JSON.stringify(report, null, 2) + "\n")
  }
}

await mergeIntoResults()
console.log(JSON.stringify({ nodeMs: report.nodeMs }, null, 2))

if (process.env.SOLIDLIL_SKIP_BROWSER === "1") process.exit(0)

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
}

function serve(directory) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const file = join(directory, decodeURIComponent(url.pathname))
    if (!file.startsWith(directory)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen(server))
  })
}

let benchmarkServer = null
let benchmarkBrowser = null
try {
  const { chromium } = await import("playwright")
  benchmarkServer = await serve(join(root, "dist"))
  const port = benchmarkServer.address().port
  benchmarkBrowser = await chromium.launch({ headless: true })

  async function bench(kind, run) {
    const page = await benchmarkBrowser.newPage()
    await page.goto(`http://127.0.0.1:${port}/apps/keyed/${kind}.html`, { waitUntil: "networkidle" })
    const samples = { create: [], update: [], swap: [], clear: [] }
    for (let i = 0; i < 9; i++) {
      const create = await run.create(page)
      samples.create.push(create)
      samples.update.push(await run.update(page))
      samples.swap.push(await run.swap(page))
      samples.clear.push(await run.clear(page))
    }
    await page.close()
    return {
      create1k: median(samples.create),
      updateEvery10th: median(samples.update),
      swap: median(samples.swap),
      clear: median(samples.clear),
    }
  }

  const actions = {
    async create(page) {
      const start = await page.evaluate(() => performance.now())
      await page.click("text=Create 1,000")
      await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1000)
      return page.evaluate((started) => performance.now() - started, start)
    },
    async update(page) {
      const start = await page.evaluate(() => performance.now())
      await page.click("text=Update every 10th")
      await page.waitForFunction(() => document.querySelector("tbody tr td a")?.textContent?.includes("!!!"))
      return page.evaluate((started) => performance.now() - started, start)
    },
    async swap(page) {
      const before = await page.evaluate(() => document.querySelector("tbody tr:nth-child(2) td")?.textContent)
      const start = await page.evaluate(() => performance.now())
      await page.click("text=Swap rows")
      await page.waitForFunction((previous) => {
        return document.querySelector("tbody tr:nth-child(2) td")?.textContent !== previous
      }, before)
      return page.evaluate((started) => performance.now() - started, start)
    },
    async clear(page) {
      const start = await page.evaluate(() => performance.now())
      await page.click("text=Clear")
      await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 0)
      return page.evaluate((started) => performance.now() - started, start)
    },
  }

  const browserMs = {
    solid: await bench("solid", actions),
    solidlil: await bench("solidlil", actions),
  }
  browserMs.ratio = {
    create1k: ratio(browserMs.solidlil.create1k, browserMs.solid.create1k),
    updateEvery10th: ratio(browserMs.solidlil.updateEvery10th, browserMs.solid.updateEvery10th),
    swap: ratio(browserMs.solidlil.swap, browserMs.solid.swap),
    clear: ratio(browserMs.solidlil.clear, browserMs.solid.clear),
  }
  report.browserMs = browserMs
  await mergeIntoResults()
  console.log(JSON.stringify({ browserMs }, null, 2))
} catch (error) {
  report.browserMs = { skipped: true, error: error.message }
  await mergeIntoResults()
  console.log("browser bench skipped:", error.message)
} finally {
  await benchmarkBrowser?.close()
  benchmarkServer?.close()
}
