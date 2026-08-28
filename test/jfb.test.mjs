import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"
import test from "node:test"
import { chromium } from "playwright"

const root = resolve(import.meta.dirname, "..", "benchmarks", "js-framework-benchmark", "keyed")
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

async function serve(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
  let path = resolve(root, `.${pathname}`)
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end()
    return
  }
  try {
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html")
    const content = await readFile(path)
    const contentType = extname(path) === ".js" ? "text/javascript" : "text/html"
    response.writeHead(200, { "content-type": contentType }).end(content)
  } catch {
    response.writeHead(404).end()
  }
}

async function exercise(browser, base, implementation) {
  const page = await browser.newPage()
  await page.addInitScript(() => {
    let state = 0x12345678
    Math.random = () => {
      state = (1664525 * state + 1013904223) >>> 0
      return state / 0x100000000
    }
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${base}/${implementation}/index.html`)
  const rows = page.locator("tbody > tr")
  await page.locator("#run").click()
  await rows.nth(999).waitFor()
  await page.locator("#update").click()
  await rows.nth(2).locator("td").nth(1).locator("a").click()
  await page.locator("#swaprows").click()
  await rows.nth(2).locator("td").nth(2).locator("a").dispatchEvent("click")
  await page.locator("#add").click()
  const snapshot = {
    count: await rows.count(),
    first: await rows.nth(0).innerText(),
    second: await rows.nth(1).innerText(),
    selected: await page.locator("tbody > tr.danger > td:first-child").allInnerTexts(),
  }
  await page.locator("#clear").click()
  snapshot.cleared = await rows.count()
  snapshot.errors = errors
  await page.close()
  return snapshot
}

test("the source-aligned keyed bundles have the same observable behavior", async () => {
  const server = createServer(serve)
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise))
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--headless=new"],
  })
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const solid = await exercise(browser, base, "solid-v2")
    const solidlil = await exercise(browser, base, "solidlil")
    assert.deepEqual(solidlil, solid)
    assert.equal(solid.count, 1999)
    assert.equal(solid.cleared, 0)
    assert.deepEqual(solid.errors, [])
  } finally {
    await browser.close()
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
})
