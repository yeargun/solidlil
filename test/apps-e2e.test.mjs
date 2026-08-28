import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { readFile, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"
import { chromium } from "playwright"
import { apps } from "../scripts/apps.mjs"

const root = resolve(import.meta.dirname, "..", "site")
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
let server
let browser
let base
const verified = []

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
    const type = extname(path) === ".js" ? "text/javascript" : extname(path) === ".css" ? "text/css" : "text/html"
    response.writeHead(200, { "content-type": type }).end(content)
  } catch {
    response.writeHead(404).end()
  }
}

before(async () => {
  server = createServer(serve)
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise))
  base = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--headless=new"],
  })
})

after(async () => {
  await browser?.close()
  if (server) await new Promise((resolvePromise) => server.close(resolvePromise))
  await writeFile(
    resolve(root, "demo-e2e.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        complete: verified.length === apps.length,
        counts: { expected: apps.length, verified: verified.length },
        contract:
          "Each Solid and SolidLil page completes the same user scenario with matching observable state and no browser errors. Runtime marker nodes are intentionally excluded.",
        apps: verified,
      },
      null,
      2,
    )}\n`,
  )
})

async function open(id, implementation) {
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => {
    const intervals = []
    window.setInterval = (callback) => {
      intervals.push(callback)
      return intervals.length
    }
    window.clearInterval = (id) => {
      intervals[id - 1] = null
    }
    window.__tickDemoIntervals = () => {
      for (const callback of intervals) callback?.()
    }
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text())
    }
  })
  await page.goto(`${base}/apps/${id}/${implementation}.html`)
  await page.locator("#app").waitFor()
  return { page, errors }
}

const text = async (locator) => (await locator.innerText()).trim()
const texts = async (locator) => (await locator.allInnerTexts()).map((value) => value.trim())
const twoFrames = (page) => page.evaluate(() => new Promise((resolvePromise) => {
  requestAnimationFrame(() => requestAnimationFrame(resolvePromise))
}))

async function waitText(page, selector, expected) {
  await page.waitForFunction(
    ({ selector, expected }) => document.querySelector(selector)?.textContent?.trim() === expected,
    { selector, expected },
  )
}

async function exercisePair(id, scenario) {
  const snapshots = []
  for (const implementation of ["solid", "solidlil"]) {
    const { page, errors } = await open(id, implementation)
    try {
      await twoFrames(page)
      assert.deepEqual(errors, [], `${id}/${implementation} initial browser errors`)
      snapshots.push(await scenario(page))
      assert.deepEqual(errors, [], `${id}/${implementation} browser errors`)
    } catch (error) {
      throw new Error(`${id}/${implementation}: ${error.message}`, { cause: error })
    } finally {
      await page.close()
    }
  }
  assert.deepEqual(snapshots[1], snapshots[0], `${id} observable parity`)
  verified.push({ id, snapshot: snapshots[0] })
}

const scenarios = {
  async counter(page) {
    const button = page.locator("#app button.count-btn")
    assert.equal(await text(button), "Count 0")
    await button.click({ clickCount: 3 })
    assert.equal(await text(button), "Count 3")
    return { button: await text(button) }
  },

  async effects(page) {
    assert.equal(await text(page.locator("#app h2")), "Split effects")
    assert.equal(await text(page.locator("#app p.muted")), "Apply phase wrote: ticks 0")
    await page.locator("#app button.primary").click()
    await waitText(page, "#app p.muted", "Apply phase wrote: ticks 1")
    return {
      button: await text(page.locator("#app button.primary")),
      result: await text(page.locator("#app p.muted")),
    }
  },

  async "form-binding"(page) {
    const input = page.locator('#app input')
    const greeting = page.locator("#app p")
    assert.equal(await input.inputValue(), "Ada")
    await input.fill("Grace")
    await waitText(page, "#app p", "Hello, Grace")
    await input.fill("")
    assert.equal(await greeting.textContent(), "Hello, ")
    return { value: await input.inputValue(), greeting: await greeting.textContent() }
  },

  async "context-theme"(page) {
    const button = page.locator("#app button")
    const child = page.locator("#app .card p")
    assert.equal(await text(child), "Child sees light")
    await button.click()
    await waitText(page, "#app .card p", "Child sees dark")
    await button.click()
    await waitText(page, "#app .card p", "Child sees light")
    return { button: await text(button), child: await text(child) }
  },

  async "async-profile"(page) {
    await waitText(page, "#app .card h3", "Ada Lovelace #1")
    await page.locator("#app button.primary").click()
    await waitText(page, "#app .card h3", "Ada Lovelace #2")
    return {
      status: await text(page.locator("#app .card p.muted")),
      profile: await text(page.locator("#app .card h3")),
      stale: await page.locator("#app .card h3").evaluate((node) => node.classList.contains("stale")),
    }
  },

  async "optimistic-save"(page) {
    const input = page.locator("#app input")
    const save = page.locator("#app button.primary")
    await input.fill("Grace")
    await save.click()
    await waitText(page, "#app .card p.muted", "reverted")
    assert.equal(await text(page.locator("#app .card p:first-child")), "Shown as Ada")
    await save.click()
    await waitText(page, "#app .card p.muted", "saved")
    return {
      shown: await text(page.locator("#app .card p:first-child")),
      status: await text(page.locator("#app .card p.muted")),
    }
  },

  async "reveal-feed"(page) {
    await page.waitForFunction(() => document.querySelectorAll("#app article.card").length === 2)
    await page.locator("#app button.primary").click()
    await page.waitForFunction(() => [...document.querySelectorAll("#app article.card")]
      .every((node) => node.textContent?.includes("#2")))
    return { articles: await texts(page.locator("#app article.card")) }
  },

  async "projection-filter"(page) {
    const input = page.locator('#app input[placeholder="filter"]')
    assert.equal(
      await input.count(),
      1,
      `projection DOM: ${await page.locator("#app").innerHTML()}`,
    )
    await input.fill("systems")
    assert.deepEqual(await texts(page.locator("#app .todo-item > strong")), ["Alan Turing", "Margaret Hamilton"])
    await input.fill("ADA")
    assert.deepEqual(await texts(page.locator("#app .todo-item > strong")), ["Ada Lovelace"])
    await input.fill("")
    return { names: await texts(page.locator("#app .todo-item > strong")) }
  },

  async "show-switch"(page) {
    const buttons = page.locator("#app > .stack > .row > button")
    await buttons.nth(2).click()
    await waitText(page, "#app .card p", "Settings: queued writes flush before paint.")
    await buttons.nth(0).click()
    await waitText(page, "#app > .stack > p.muted", "Panel hidden")
    await buttons.nth(1).click()
    await buttons.nth(0).click()
    await waitText(page, "#app .card p", "Home: fine-grained updates, no VDOM.")
    return { panel: await text(page.locator("#app .card p")) }
  },

  async "repeat-grid"(page) {
    const buttons = page.locator("#app > .stack > .row > button")
    await buttons.nth(0).click({ clickCount: 4 })
    assert.equal(await page.locator("#app .grid > .cell").count(), 0)
    await buttons.nth(1).click()
    return {
      count: await text(page.locator("#app > .stack > .row > span")),
      cells: await texts(page.locator("#app .grid > .cell")),
    }
  },

  async "nested-tree"(page) {
    const rows = page.locator("#app .row")
    const appsRow = rows.filter({ has: page.locator("span", { hasText: /^apps$/ }) })
    await appsRow.locator("button").click()
    assert.deepEqual(await texts(page.locator("#app .row > span")), ["src", "reactive.lil", "web.lil", "apps"])
    await appsRow.locator("button").click()
    return { names: await texts(page.locator("#app .row > span")) }
  },

  async "error-reset"(page) {
    await page.locator("#app > .stack > button").click()
    await twoFrames(page)
    assert.equal(
      await page.locator("#app .card button").count(),
      1,
      `error-reset DOM: ${await page.locator("#app").innerHTML()}`,
    )
    assert.match(await text(page.locator("#app .card p")), /Boom/)
    await page.locator("#app .card button").click()
    await waitText(page, "#app > .stack > p", "All clear")
    return { status: await text(page.locator("#app > .stack > p")) }
  },

  async todolist(page) {
    const draft = page.locator('#app input[placeholder="What needs doing?"]')
    const add = page.locator("#app button.primary")
    await draft.fill("Write tests")
    await add.click()
    await draft.fill("Ship demo")
    await add.click()
    await page.locator("#app .todo-item").nth(0).locator('input[type="checkbox"]').click()
    const filters = page.locator("#app > .stack > .row:nth-of-type(2) button")
    await filters.nth(1).click()
    assert.deepEqual(await texts(page.locator("#app .todo-item > span")), ["Ship demo"])
    await filters.nth(0).click()
    return {
      titles: await texts(page.locator("#app .todo-item > span")),
      remaining: await text(page.locator("#app > .stack > p.muted")),
    }
  },

  async "store-cart"(page) {
    const items = page.locator("#app .todo-item")
    await items.nth(0).locator("button").nth(0).click({ clickCount: 2 })
    await items.nth(1).locator("button").nth(1).click()
    await items.nth(2).locator("button").nth(1).click()
    return {
      quantities: await texts(page.locator("#app .todo-item > strong")),
      total: await text(page.locator("#app > .stack > p")),
    }
  },

  async kanban(page) {
    const lanes = page.locator("#app .board > .lane")
    await lanes.nth(0).locator(".card-item").nth(0).locator("button").click()
    await lanes.nth(1).locator(".card-item").nth(0).locator(".row button").nth(1).click()
    await lanes.nth(2).locator(".card-item").nth(0).locator("button").click()
    await lanes.nth(1).locator(".card-item").nth(0).locator(".row button").nth(0).click()
    await lanes.nth(0).locator("button.primary").click({ clickCount: 2 })
    return {
      todo: await texts(lanes.nth(0).locator(".card-item > span")),
      doing: await texts(lanes.nth(1).locator(".card-item > span")),
      done: await texts(lanes.nth(2).locator(".card-item > span")),
    }
  },

  async inbox(page) {
    const rows = page.locator("#app button.mail-row")
    await rows.nth(0).click()
    const filters = page.locator("#app > .stack > .row > button")
    await filters.nth(1).click()
    await page.locator("#app button.mail-row").nth(0).click()
    await filters.nth(0).click()
    return {
      summary: await text(page.locator("#app > .stack > p.muted")),
      subjects: await texts(page.locator("#app button.mail-row > span")),
      detail: await text(page.locator("#app .inbox > .card > h3")),
    }
  },

  async marketplace(page) {
    const filterButtons = page.locator("#app .market > div:first-child > .row:nth-of-type(2) button")
    const input = page.locator('#app input[placeholder="Search kits"]')
    await filterButtons.nth(2).click()
    await input.fill("TREE")
    assert.deepEqual(await texts(page.locator("#app .product > strong")), ["Piece tree"])
    await filterButtons.nth(0).click()
    await input.fill("")
    const add = page.locator("#app .product button.primary")
    await add.nth(0).click({ clickCount: 2 })
    await add.nth(2).click()
    return {
      products: await texts(page.locator("#app .product > strong")),
      cart: await text(page.locator("#app .cart > h3")),
      total: await text(page.locator("#app .cart > p:not(.muted)")),
    }
  },

  async keyed(page) {
    const buttons = page.locator("#app > .stack > .row > button")
    const rows = page.locator("#app tbody > tr")
    await buttons.nth(0).click()
    await rows.nth(999).waitFor()
    await buttons.nth(3).click()
    await rows.nth(1).locator("td").nth(1).locator("a").click()
    await buttons.nth(5).click()
    const selectedId = await text(page.locator("#app tr.danger > td:first-child"))
    await buttons.nth(4).click()
    return { selectedId, cleared: await rows.count() }
  },

  async spreadsheet(page) {
    const cell = page.locator("#app .sheet tbody > tr:nth-child(3) > td:nth-of-type(4)")
    await cell.click()
    const buttons = page.locator("#app > .stack > .row > button")
    await buttons.nth(0).click()
    await buttons.nth(1).click()
    return {
      label: await text(page.locator("#app > .stack > .row > span")),
      value: await text(cell),
      selected: await page.locator("#app .sheet td.sel").count(),
    }
  },

  async "svg-clock"(page) {
    const hand = page.locator("#app svg.clock > line")
    assert.equal(await hand.getAttribute("transform"), "rotate(0 50 50)")
    await page.evaluate(() => window.__tickDemoIntervals())
    assert.equal(await hand.getAttribute("transform"), "rotate(6 50 50)")
    return {
      namespace: await page.locator("#app svg.clock").evaluate((node) => node.namespaceURI),
      transform: await hand.getAttribute("transform"),
    }
  },

  async "portal-modal"(page) {
    await page.locator("#app button.primary").click()
    assert.equal(await page.locator("body > .modal-back").count(), 1)
    assert.equal(await page.locator("#app .modal-back").count(), 0)
    const heading = await text(page.locator("body > .modal-back h3"))
    await page.locator("body > .modal-back button").click()
    return { heading, overlays: await page.locator("body > .modal-back").count() }
  },
}

assert.deepEqual(Object.keys(scenarios).sort(), apps.map(({ id }) => id).sort())
for (const { id, title } of apps) {
  test(`${id}: ${title}`, () => exercisePair(id, scenarios[id]))
}
