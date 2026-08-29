import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { after, before, test } from "node:test"
import { build } from "esbuild"
import { chromium } from "playwright"

const root = resolve(import.meta.dirname, "../..")
const compiler = process.env.SOLIDLIL_LILSCRIPT_BIN ?? resolve(root, "../lilscript/target/release/lilscript")
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
let output
let candidate
let reference
let browser

function compile(input, name, config = "test/upstream/dom-web-oracle.toml", mode = "development") {
  const target = join(output, `${name}.mjs`)
  execFileSync(
    compiler,
    [
      resolve(root, input),
      "--target", "js-module",
      "--config", resolve(root, config),
      "--mode", mode,
      "--output", target,
    ],
    { cwd: root, stdio: "pipe" },
  )
  return target
}

async function bundle(contents, name, resolveDir = root) {
  const target = join(output, `${name}.js`)
  await build({
    stdin: { contents, loader: "js", resolveDir },
    outfile: target,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    conditions: ["browser", "import"],
    nodePaths: [resolve(root, "node_modules")],
  })
  return target
}

before(async () => {
  assert.equal(existsSync(compiler), true, `LilScript compiler not found at ${compiler}`)
  output = await mkdtemp(join(tmpdir(), "solidlil-dom-web-"))
  const runtime = compile("test/upstream/dom-web-runtime.lil", "runtime", "src/lilscript.toml", "production")
  const client = compile("test/upstream/dom-web-client.lil", "client")
  const solidEntry = compile("test/upstream/dom-web-solid.lil", "solid-entry")
  const solid = compile("src/upstream/solid-web/src/index.lil", "solid")
  const optimizedClient = compile("test/upstream/dom-web-client.lil", "client-optimized", "test/upstream/exact-production.toml", "production")
  const optimizedSolidEntry = compile("test/upstream/dom-web-solid.lil", "solid-entry-optimized", "test/upstream/exact-production.toml", "production")
  candidate = await import(`${pathToFileURL(runtime).href}?${Date.now()}`)
  const referenceRuntime = join(output, "reference-runtime.mjs")
  await build({
    stdin: {
      contents: `export * from "./upstream/dom-expressions/packages/runtime/src/cookies.js";
export * from "./upstream/dom-expressions/packages/runtime/src/head.js";
export * from "./upstream/dom-expressions/packages/runtime/src/response.js";
export * from "./upstream/dom-expressions/packages/runtime/src/server-functions/registry.js";`,
      loader: "js",
      resolveDir: root,
    },
    outfile: referenceRuntime,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
  })
  reference = await import(`${pathToFileURL(referenceRuntime).href}?${Date.now()}`)

  const candidateClient = await bundle(
    `import * as api from ${JSON.stringify(client)};
import * as runtime from ${JSON.stringify(runtime)};
globalThis.Candidate = { ...api, ...runtime };
globalThis.CandidateSupport = { createRoot: api.__createRoot, createSignal: api.__createSignal, flush: api.__flush };`,
    "candidate-client",
    output,
  )
  const candidateSolid = await bundle(
    `import * as api from ${JSON.stringify(solidEntry)};
globalThis.CandidateSolid = api;
globalThis.CandidateSolidSupport = { createRoot: api.__createRoot, createSignal: api.__createSignal, flush: api.__flush };`,
    "candidate-solid",
    output,
  )
  const candidateSolidSurface = await bundle(
    `import * as api from ${JSON.stringify(solid)};
globalThis.CandidateSolidSurface = api;`,
    "candidate-solid-surface",
    output,
  )
  const candidateOptimized = await bundle(
    `import * as api from ${JSON.stringify(optimizedClient)};
import * as runtime from ${JSON.stringify(runtime)};
globalThis.CandidateOptimized = { ...api, ...runtime };
globalThis.CandidateOptimizedSupport = { createRoot: api.__createRoot, createSignal: api.__createSignal, flush: api.__flush };`,
    "candidate-optimized",
    output,
  )
  const candidateSolidOptimized = await bundle(
    `import * as api from ${JSON.stringify(optimizedSolidEntry)};
globalThis.CandidateSolidOptimized = api;
globalThis.CandidateSolidOptimizedSupport = { createRoot: api.__createRoot, createSignal: api.__createSignal, flush: api.__flush };`,
    "candidate-solid-optimized",
    output,
  )
  const referenceClient = await bundle(
    `import * as api from ${JSON.stringify(resolve(root, "node_modules/@solidjs/web/dist/web.js"))};
import reconcileArrays from ${JSON.stringify(resolve(root, "upstream/dom-expressions/packages/runtime/src/reconcile.js"))};
import { $$SLOT } from ${JSON.stringify(resolve(root, "upstream/dom-expressions/packages/runtime/src/constants.js"))};
import { createRoot, createSignal, flush } from "solid-js";
globalThis.Reference = { ...api, reconcileArrays, $$SLOT };
globalThis.ReferenceSupport = { createRoot, createSignal, flush };`,
    "reference-client",
  )
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromePath) ? { executablePath: chromePath, args: ["--headless=new"] } : {}),
  })
  browser.__bundles = {
    candidateClient,
    candidateOptimized,
    candidateSolid,
    candidateSolidSurface,
    candidateSolidOptimized,
    referenceClient,
  }
})

after(async () => {
  await browser?.close()
  if (output) await rm(output, { recursive: true, force: true })
})

test("all DOM/Web compile entries compile as reusable ESM", () => {
  for (const name of ["runtime.mjs", "client.mjs", "solid-entry.mjs", "solid.mjs"]) {
    assert.equal(existsSync(join(output, name)), true, name)
  }
})

test("cookie parsing and serialization match the pinned runtime", () => {
  assert.equal(candidate.serializeCookie.length, reference.serializeCookie.length)
  const headers = [
    null,
    "",
    "plain=value; quoted=\"hello%20world\"; encoded%20name=a%2Fb; malformed=%E0%A4%A; flag",
  ]
  for (const header of headers) {
    assert.deepEqual(candidate.parseCookieHeader(header), reference.parseCookieHeader(header))
    assert.equal(candidate.hasFlashCookie(header), reference.hasFlashCookie(header))
    assert.equal(candidate.matchFlashCookie(header), reference.matchFlashCookie(header))
  }
  const cases = [
    ["name", "value"],
    ["sp ace", "a/b", { path: "/app", domain: "example.test", maxAge: 4.9, secure: true }],
    ["session", "ok", { path: "", expires: new Date("2030-01-02T03:04:05Z"), httpOnly: true, sameSite: "STRICT" }],
  ]
  for (const args of cases) {
    assert.equal(candidate.serializeCookie(...args), reference.serializeCookie(...args))
  }
  assert.equal(candidate.clearFlashCookie(), reference.clearFlashCookie())
})

function simplifyWinners(value) {
  return [...value].map(([identity, winner]) => ({
    identity,
    seq: winner.seq,
    tags: winner.tags.map(({ tag, props, identity: tagIdentity }) => ({ tag, props, identity: tagIdentity })),
  }))
}

test("head classification, identity, and group resolution match", () => {
  const descriptors = [
    { tag: "link", props: { rel: () => "stylesheet", href: "/app.css", crossorigin: "anonymous" } },
    { tag: "meta", props: { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#000" } },
    { tag: "script", props: { children: "x" } },
  ]
  for (const descriptor of descriptors) {
    assert.deepEqual(candidate.classifyHeadTag(descriptor), reference.classifyHeadTag(descriptor))
    const leftProps = candidate.evalHeadProps(descriptor.props)
    const rightProps = reference.evalHeadProps(descriptor.props)
    assert.deepEqual(leftProps, rightProps)
    assert.equal(candidate.resourceIdentity(descriptor.tag, leftProps), reference.resourceIdentity(descriptor.tag, rightProps))
    assert.equal(
      candidate.replaceableIdentity(descriptor.tag, leftProps, null, "unique"),
      reference.replaceableIdentity(descriptor.tag, rightProps, null, "unique"),
    )
  }
  const groups = [
    { seq: 2, tags: [{ tag: "title", props: { children: "new" }, identity: "title" }] },
    { seq: 1, tags: [
      { tag: "title", props: { children: "old" }, identity: "title" },
      { tag: "meta", props: { name: "description", content: "a" }, identity: "meta:name:description" },
    ] },
    { seq: 3, tags: [
      { tag: "meta", props: { name: "description", content: "b" }, identity: "meta:name:description" },
      { tag: "meta", props: { name: "description", content: "c" }, identity: "meta:name:description" },
    ] },
  ]
  assert.deepEqual(simplifyWinners(candidate.resolveHead(groups)), simplifyWinners(reference.resolveHead(groups)))
})

test("response helpers preserve response metadata, values, and brands", async () => {
  for (const api of [reference, candidate]) {
    assert.equal(api.redirect.length, 1)
    assert.equal(api.reload.length, 0)
    assert.equal(api.respond.length, 1)
  }
  assert.equal(candidate.ResponseEnvelope.name, "ResponseEnvelope")
  const href = { [candidate.HREF]: true, toString: () => "/typed" }
  const redirected = candidate.redirect(href, { status: 307, revalidate: ["one", "two"] })
  const expected = reference.redirect({ [reference.HREF]: true, toString: () => "/typed" }, { status: 307, revalidate: ["one", "two"] })
  assert.equal(redirected.status, expected.status)
  assert.deepEqual([...redirected.headers], [...expected.headers])
  const envelope = candidate.respond({ ok: true }, { status: 201, revalidate: "item" })
  assert.equal(candidate.isResponseEnvelope(envelope), true)
  assert.equal(reference.isResponseEnvelope(envelope), true)
  assert.deepEqual(envelope.value, { ok: true })
  assert.equal(await envelope.response.text(), JSON.stringify({ ok: true }))
  const error = new Error("public")
  assert.equal(candidate.markSafeError(error), error)
  assert.equal(reference.isSafeError(error), true)
  assert.equal(Object.getOwnPropertyDescriptor(error, candidate.SAFE_ERROR).enumerable, false)
  assert.equal(candidate.isHref({ [candidate.HREF]: "truthy" }), true)
  assert.equal(candidate.isSafeError({ [candidate.SAFE_ERROR]: "truthy" }), true)
})

test("server-function metadata and global RPC seam match", () => {
  for (const api of [reference, candidate]) {
    const fn = () => {}
    fn[api.SERVER_FUNCTION_METADATA] = { method: "GET" }
    assert.equal(api.isServerFunction(fn), true)
    assert.equal(api.getServerFunctionMetadata(fn), fn[api.SERVER_FUNCTION_METADATA])
    assert.equal(api.withMeta(fn, { auth: true }), fn)
    assert.deepEqual(api.getServerFunctionMetadata(fn), { method: "GET", auth: true })
    assert.throws(() => api.withMeta(() => {}, {}), /withMeta expects a server function reference/)
    const seam = Symbol.for("solid.ServerFunctionRPC")
    delete globalThis[seam]
    const first = { id: 1 }
    api.provideServerFunctionRPC(first)
    api.provideServerFunctionRPC({ id: 2 })
    assert.equal(api.getServerFunctionRPC(), first)
    delete globalThis[seam]
  }
})

async function browserSnapshot(globalName, supportName) {
  const page = await browser.newPage()
  try {
    await page.setContent("<!doctype html><html><head><title>shell</title></head><body></body></html>")
    if (globalName === "Candidate") {
      await page.addScriptTag({ path: browser.__bundles.candidateClient })
    } else if (globalName === "CandidateOptimized") {
      await page.addScriptTag({ path: browser.__bundles.candidateOptimized })
    } else if (globalName === "CandidateSolid") {
      await page.addScriptTag({ path: browser.__bundles.candidateSolid })
    } else if (globalName === "CandidateSolidOptimized") {
      await page.addScriptTag({ path: browser.__bundles.candidateSolidOptimized })
    } else {
      await page.addScriptTag({ path: browser.__bundles.referenceClient })
    }
    const snapshot = await page.evaluate(async ({ globalName, supportName }) => {
      const api = globalThis[globalName]
      const support = globalThis[supportName]

      const classNode = document.createElement("div")
      api.className(classNode, ["alpha beta", { beta: false, gamma: true }], {})
      const styleValue = { color: "red", "--gap": "2px" }
      api.style(classNode, styleValue)
      styleValue.color = "blue"
      delete styleValue["--gap"]
      api.style(classNode, styleValue, styleValue)
      api.setAttribute(classNode, "data-empty", true)
      api.setAttribute(classNode, "data-drop", false)
      api.setProperty(classNode, "title", "property")

      const range = document.createElement("div")
      const a = document.createElement("i")
      const b = document.createElement("b")
      const c = document.createElement("u")
      const marker = document.createComment("end")
      const foreign = document.createElement("link")
      range.append(a, b, marker, foreign)
      api.insert(range, [b, c], marker, [a, b])

      const eventRoot = document.createElement("div")
      const eventParent = document.createElement("section")
      const eventChild = document.createElement("button")
      eventParent.append(eventChild)
      eventRoot.append(eventParent)
      document.body.append(eventRoot)
      const events = []
      api.registerDelegatedRoot(eventRoot)
      api.delegateEvents(["click"])
      api.addEvent(eventChild, "click", event => events.push(["child", event.currentTarget === eventChild]), true)
      api.addEvent(eventParent, "click", event => events.push(["parent", event.currentTarget === eventParent]), true)
      eventChild.click()
      api.unregisterDelegatedRoot(eventRoot)
      eventChild.click()

      const asset = { type: "inline-style", id: "theme", content: ".x{color:red}", attrs: { media: "all" } }
      const releaseA = api.acquireAsset(asset)
      const firstAsset = document.querySelector('style[data-asset="theme"]')
      const releaseB = api.acquireAsset(asset)
      const secondAsset = document.querySelector('style[data-asset="theme"]')
      releaseA()
      releaseB()
      await new Promise(resolve => setTimeout(resolve, 120))
      const assetRemoved = !firstAsset.isConnected

      const disposeHead = support.createRoot(dispose => {
        api.useHead([
          { tag: "title", props: { children: "managed" } },
          { tag: "meta", props: { name: "description", content: "first" } },
        ])
        return dispose
      })
      support.flush()
      await Promise.resolve()
      const managedHead = {
        title: document.title,
        meta: document.head.querySelector('meta[name="description"]')?.content,
      }
      disposeHead()
      support.flush()
      await Promise.resolve()
      const restoredTitle = document.title

      return {
        attributes: [...classNode.attributes].map(attribute => [attribute.name, attribute.value]).sort(),
        className: classNode.className,
        style: classNode.getAttribute("style"),
        titleProperty: classNode.title,
        range: [...range.childNodes].map(node => node === b ? "b" : node === c ? "c" : node === marker ? "marker" : "foreign"),
        rangeIdentity: range.firstChild === b && b.nextSibling === c,
        events,
        delegatedRootAfterDispose: api.getDelegatedRoot(eventChild) === undefined,
        assetIdentity: firstAsset === secondAsset,
        assetText: firstAsset?.textContent,
        assetRemoved,
        managedHead,
        restoredTitle,
      }
    }, { globalName, supportName })
    return snapshot
  } finally {
    await page.close()
  }
}

test("browser attributes, styles, delegation, assets, and head ownership match", async () => {
  const expected = await browserSnapshot("Reference", "ReferenceSupport")
  const actual = await browserSnapshot("Candidate", "CandidateSupport")
  assert.deepEqual(actual, expected)
  const optimized = await browserSnapshot("CandidateOptimized", "CandidateOptimizedSupport")
  assert.deepEqual(optimized, expected)
})

async function reconcileSnapshot(globalName) {
  const page = await browser.newPage()
  try {
    await page.setContent("<!doctype html><body></body>")
    await page.addScriptTag({
      path: globalName === "Reference"
        ? browser.__bundles.referenceClient
        : globalName === "CandidateOptimized"
          ? browser.__bundles.candidateOptimized
          : browser.__bundles.candidateClient,
    })
    return await page.evaluate(globalName => {
      const api = globalThis[globalName]
      const parent = document.createElement("div")
      const marker = document.createComment("end")
      const nodes = ["a", "b", "c", "d"].map(id => {
        const node = document.createElement("span")
        node.id = id
        return node
      })
      parent.append(nodes[0], nodes[1], nodes[2], marker)
      api.reconcileArrays(parent, nodes.slice(0, 3), [nodes[2], nodes[0], nodes[3]], marker)
      return {
        order: [...parent.childNodes].map(node => node.id || `#${node.nodeType}`),
        identities: [...parent.querySelectorAll("span")].map(node => nodes.indexOf(node)),
        slotOwned: [nodes[0], nodes[2], nodes[3]].every(node => node[api.$$SLOT] === marker),
      }
    }, globalName)
  } finally {
    await page.close()
  }
}

test("reconciliation preserves exact node identities and insertion range", async () => {
  assert.deepEqual(await reconcileSnapshot("Candidate"), await reconcileSnapshot("Reference"))
  assert.deepEqual(await reconcileSnapshot("CandidateOptimized"), await reconcileSnapshot("Reference"))
})

async function portalSnapshot(globalName, supportName) {
  const page = await browser.newPage()
  try {
    await page.setContent('<!doctype html><body><main id="source"></main><aside id="target"></aside></body>')
    await page.addScriptTag({
      path: globalName === "CandidateSolid"
        ? browser.__bundles.candidateSolid
        : globalName === "CandidateSolidOptimized"
          ? browser.__bundles.candidateSolidOptimized
          : browser.__bundles.referenceClient,
    })
    return await page.evaluate(async ({ globalName, supportName }) => {
      const api = globalThis[globalName]
      const support = globalThis[supportName]
      const source = document.querySelector("#source")
      const target = document.querySelector("#target")
      const child = document.createElement("button")
      child.textContent = "inside"
      const dispose = support.createRoot(rootDispose => {
        source.append(api.Portal({ mount: target, children: child }))
        return rootDispose
      })
      support.flush()
      const mounted = {
        sourceNodes: source.childNodes.length,
        targetText: target.textContent,
        targetNodes: target.childNodes.length,
      }
      dispose()
      support.flush()
      return { mounted, disposedTargetNodes: target.childNodes.length }
    }, { globalName, supportName })
  } finally {
    await page.close()
  }
}

test("Portal owns and cleans its exact target range", async () => {
  const expected = await portalSnapshot("Reference", "ReferenceSupport")
  const actual = await portalSnapshot("CandidateSolid", "CandidateSolidSupport")
  assert.deepEqual(actual, expected)
  const optimized = await portalSnapshot("CandidateSolidOptimized", "CandidateSolidOptimizedSupport")
  assert.deepEqual(optimized, expected)
})

test("Solid Web browser entry exports the pinned runtime surface", async () => {
  const page = await browser.newPage()
  try {
    await page.setContent("<!doctype html><body></body>")
    await page.addScriptTag({ path: browser.__bundles.referenceClient })
    await page.addScriptTag({ path: browser.__bundles.candidateSolidSurface })
    const keys = await page.evaluate(() => ({
      expected: Object.keys(globalThis.Reference).filter(key => key !== "reconcileArrays" && key !== "$$SLOT").sort(),
      actual: Object.keys(globalThis.CandidateSolidSurface).filter(key => !key.startsWith("__")).sort(),
      arityMismatches: Object.keys(globalThis.Reference)
        .filter(key => typeof globalThis.Reference[key] === "function" && typeof globalThis.CandidateSolidSurface[key] === "function")
        .filter(key => globalThis.Reference[key].length !== globalThis.CandidateSolidSurface[key].length)
        .map(key => [key, globalThis.Reference[key].length, globalThis.CandidateSolidSurface[key].length]),
    }))
    assert.deepEqual(keys.actual, keys.expected)
    assert.deepEqual(keys.arityMismatches, [])
  } finally {
    await page.close()
  }
})

async function dynamicSnapshot(globalName, supportName, bundlePath) {
  const page = await browser.newPage()
  try {
    await page.setContent('<!doctype html><body><main id="root"></main></body>')
    await page.addScriptTag({ path: bundlePath })
    return await page.evaluate(({ globalName, supportName }) => {
      const api = globalThis[globalName]
      const support = globalThis[supportName]
      const [tag, setTag] = support.createSignal("button")
      const props = {
        get component() {
          return tag()
        },
        id: "dynamic-node",
        children: "content",
      }
      const root = document.querySelector("#root")
      const dispose = api.render(() => api.Dynamic(props), root)
      const first = root.firstChild
      setTag("section")
      support.flush()
      const result = {
        firstTag: first.tagName,
        nextTag: root.firstChild.tagName,
        replaced: root.firstChild !== first,
        id: root.firstChild.id,
        text: root.textContent,
      }
      dispose()
      return { ...result, disposed: root.childNodes.length }
    }, { globalName, supportName })
  } finally {
    await page.close()
  }
}

test("render and Dynamic preserve native element switching", async () => {
  const expected = await dynamicSnapshot("Reference", "ReferenceSupport", browser.__bundles.referenceClient)
  const actual = await dynamicSnapshot("CandidateSolid", "CandidateSolidSupport", browser.__bundles.candidateSolid)
  const optimized = await dynamicSnapshot(
    "CandidateSolidOptimized",
    "CandidateSolidOptimizedSupport",
    browser.__bundles.candidateSolidOptimized,
  )
  assert.deepEqual(actual, expected)
  assert.deepEqual(optimized, expected)
})

async function hydrationSnapshot(globalName, supportName, bundlePath) {
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", error => errors.push(error.stack ?? error.message))
  try {
    await page.setContent('<!doctype html><body><main id="root"><button _hk="0">server</button></main></body>')
    await page.addScriptTag({ path: bundlePath })
    const snapshot = await page.evaluate(async ({ globalName, supportName }) => {
      globalThis._$HY = {
        events: [],
        completed: new WeakSet(),
        r: { _assets: { unit: "data:text/javascript,export default 1" } },
        fe() {},
      }
      const api = globalThis[globalName]
      const support = globalThis[supportName]
      const root = document.querySelector("#root")
      const original = root.firstChild
      let claimed
      api.hydrate(() => {
        claimed = api.getNextElement(() => {
          const fallback = document.createElement("button")
          fallback.textContent = "client"
          return fallback
        })
        return claimed
      }, root)
      for (let attempt = 0; attempt < 100 && (!globalThis._$HY.modules?.unit || claimed === undefined); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      support.flush()
      return {
        claimed: claimed === original,
        module: globalThis._$HY.modules.unit.default,
        count: root.childNodes.length,
        html: root.innerHTML,
      }
    }, { globalName, supportName })
    return { ...snapshot, errors }
  } finally {
    await page.close()
  }
}

test("hydration claims server nodes without replacing them", async () => {
  const expected = await hydrationSnapshot(
    "Reference",
    "ReferenceSupport",
    browser.__bundles.referenceClient,
  )
  const actual = await hydrationSnapshot(
    "CandidateSolid",
    "CandidateSolidSupport",
    browser.__bundles.candidateSolid,
  )
  const optimized = await hydrationSnapshot(
    "CandidateSolidOptimized",
    "CandidateSolidOptimizedSupport",
    browser.__bundles.candidateSolidOptimized,
  )
  assert.deepEqual(actual, expected)
  assert.deepEqual(optimized, expected)
  assert.equal(actual.claimed, true)
})
