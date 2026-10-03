// Port-owned compatibility factory. The compiler supplies the checked core.
import {
  ChildProperties,
  DOMElements,
  DOMWithState,
  DelegatedEvents,
  MathMLElements,
  Namespaces,
  RawTextElements,
  SVGElements,
  VoidElements,
} from "./dom-tables.mjs"

export function createWebApi(solid, lil) {
const {Errored, For, Hydration, Loading, Match, NoHydration, Repeat, Reveal, Show, Switch, children, createComponent, createMemo, createRenderEffect, createRoot, enableHydration, finishHydration, flush, getOwner, merge, onCleanup, sharedConfig, untrack} = solid;
const HREF = Symbol.for("solid.Href")
const SAFE_ERROR = Symbol.for("solid.SafeError")
const RequestContext = Symbol.for("solid.RequestContext")
const REVALIDATE_HEADER = "X-Revalidate"
const isServer = false
const isDev = false

const delegatedRoots = new Set()
const delegatedContainers = new Map()
const elementClaims = new Set()
const hydrationEvents = []
let requestEvent
let hydrateCursor = null
const assets = new Map()
const headTags = []

function render(code, element, init, options) {
  if (typeof code === "string") return lil.render(code, element)
  const hydrating = options?.hydrate || sharedConfig.hydrating
  return createRoot((dispose) => {
    if (!hydrating && element && "textContent" in element) element.textContent = ""
    insert(element, code, undefined, init)
    flush()
    onCleanup(() => {
      if (element && "textContent" in element) element.textContent = ""
    })
    return dispose
  })
}

function hydrate(code, node, options) {
  enableHydration()
  hydrateCursor = node?.firstChild ?? null
  const dispose = render(code, node, undefined, { ...options, hydrate: true })
  finishHydration()
  hydrateCursor = null
  runHydrationEvents()
  return dispose
}

function insert(parent, accessor, marker, current) {
  if (typeof accessor !== "function") {
    return applyInsert(parent, accessor, marker, current)
  }
  let nodes = current
  createRenderEffect(() => {
    nodes = applyInsert(parent, accessor(), marker, nodes)
  })
  return nodes
}

function isDomNode(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (typeof value.nodeType === "number" ||
        (typeof Node !== "undefined" && value instanceof Node)),
  )
}

function asNodes(value) {
  if (value == null || value === false || value === true) return []
  if (typeof value === "function") return asNodes(value())
  if (typeof value === "string" || typeof value === "number") {
    if (typeof document === "undefined") return []
    return [document.createTextNode(String(value))]
  }
  if (Array.isArray(value)) return value.flatMap(asNodes)
  if (isDomNode(value)) return [value]
  return asNodes(value)
}

function applyInsert(parent, value, marker, previous) {
  const next = asNodes(value)
  const prev = Array.isArray(previous) ? previous : previous ? [previous] : []
  for (const node of prev) {
    if (!next.includes(node) && node.parentNode) node.parentNode.removeChild(node)
  }
  let cursor = marker ?? null
  for (const node of next) {
    if (sharedConfig.hydrating && node.parentNode === parent) continue
    if (node !== cursor && typeof parent.insertBefore === "function") {
      parent.insertBefore(node, cursor)
    }
    cursor = node.nextSibling ?? cursor
  }
  return next
}

function template(html, flag) {
  const node = document.createElement("template")
  node.innerHTML = html
  const first = () => {
    const content = flag === 2 ? node.content.firstChild : node.content
    const root = content.firstChild ?? content
    return root.cloneNode(true)
  }
  return () => {
    if (sharedConfig.hydrating) return getNextElement(first)
    return first()
  }
}

function getHydrationKey() {
  return sharedConfig.getNextContextId?.()
}

function getNextElement(factory) {
  if (sharedConfig.hydrating && hydrateCursor) {
    const node = hydrateCursor
    hydrateCursor = hydrateCursor.nextSibling
    return node
  }
  return typeof factory === "function" ? factory() : document.createElement("div")
}

function getNextMatch(start, elementName) {
  let cursor = start
  while (cursor) {
    if (cursor.nodeName?.toLowerCase() === elementName.toLowerCase()) return cursor
    cursor = cursor.nextSibling
  }
  return getNextElement()
}

function getNextMarker(start) {
  const nodes = []
  let cursor = start
  while (cursor) {
    if (cursor.nodeType === 8) return [cursor, nodes]
    nodes.push(cursor)
    cursor = cursor.nextSibling
  }
  return [start, nodes]
}

function runHydrationEvents() {
  while (hydrationEvents.length) hydrationEvents.shift()?.()
}

function Portal(props) {
  const mount = props.mount ?? (typeof document === "undefined" ? null : document.body)
  const nodes = children(() => props.children)
  if (mount) {
    createRenderEffect(() => {
      const list = nodes.toArray()
      for (const node of list) mount.appendChild(node)
    })
    onCleanup(() => {
      for (const node of nodes.toArray()) node.parentNode?.removeChild(node)
    })
  }
  return document?.createTextNode("") ?? null
}

function dynamic(source) {
  return (props) => {
    const Comp = typeof source === "function" ? source() : source
    if (!Comp) return undefined
    if (typeof Comp === "string") {
      const node = document.createElement(Comp)
      assign(node, props)
      return node
    }
    return createComponent(Comp, props)
  }
}

function Dynamic(props) {
  const { component, ...rest } = props
  return dynamic(() => component)(rest)
}

function clientOnly(fn, options) {
  let loaded
  const Comp = (props) => {
    if (sharedConfig.hydrating) return props.fallback
    if (!loaded) {
      if (!options?.lazy) fn().then((mod) => { loaded = mod.default })
      return props.fallback
    }
    return loaded(props)
  }
  if (!options?.lazy) fn().then((mod) => { loaded = mod.default })
  return Comp
}

function httpStatus() {}
function httpHeader() {}

function effect(fn, apply) {
  return createRenderEffect(fn, apply)
}

function memo(fn) {
  return createMemo(fn)
}

function scope(fn) {
  return fn
}

function mergeProps(...sources) {
  return merge(...sources)
}

function spread(node, accessor, skipChildren) {
  const apply = (props) => assign(node, props, skipChildren)
  if (typeof accessor === "function") createRenderEffect(() => apply(accessor()))
  else apply(accessor)
}

function assign(node, props, skipChildren, prev = {}, skipRef) {
  const next = props ?? {}
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (key === "children" && skipChildren) continue
    if (key === "ref" && skipRef) continue
    if (key === "class" || key === "className") className(node, next[key], prev[key])
    else if (key === "style") style(node, next[key], prev[key])
    else if (key.startsWith("on")) addEvent(node, key.slice(2).toLowerCase(), next[key], DelegatedEvents.has(key.slice(2).toLowerCase()))
    else if (next[key] == null) node.removeAttribute?.(key)
    else if (key in node && !ChildProperties.has(key)) node[key] = next[key]
    else setAttribute(node, key, next[key])
  }
  return next
}

function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name)
  else node.setAttribute(name, String(value))
}

function setAttributeNS(node, namespace, name, value) {
  if (value == null) node.removeAttributeNS(namespace, name)
  else node.setAttributeNS(namespace, name, String(value))
}

function className(node, value) {
  node.className = value == null ? "" : String(value)
}

function setProperty(node, name, value) {
  node[name] = value
}

function setStyleProperty(node, name, value) {
  node.style[name] = value
}

function style(node, value, prev = {}) {
  const next = value ?? {}
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    node.style[key] = next[key] ?? ""
  }
}

function addEvent(node, name, handler, delegate) {
  if (!handler) return
  if (delegate) {
    node[`$$${name}`] = handler
    return
  }
  node.addEventListener(name, handler)
}

function delegateEvents(eventNames) {
  for (const name of eventNames) {
    document.addEventListener(name, (event) => {
      let target = event.target
      while (target) {
        const handler = target[`$$${name}`]
        if (handler) {
          handler(event)
          return
        }
        target = target.parentNode
      }
    })
  }
}

function registerDelegatedRoot(root) {
  delegatedRoots.add(root)
}
function unregisterDelegatedRoot(root) {
  delegatedRoots.delete(root)
}
function registerDelegatedContainer(container, owner) {
  delegatedContainers.set(container, owner)
}
function unregisterDelegatedContainer(container) {
  delegatedContainers.delete(container)
}
function getDelegatedRoot(node) {
  let cursor = node
  while (cursor) {
    if (delegatedRoots.has(cursor)) return cursor
    cursor = cursor.parentNode
  }
}

function registerElementClaim(handler) {
  elementClaims.add(handler)
  return () => elementClaims.delete(handler)
}
function claimElement(node) {
  for (const handler of elementClaims) handler(node)
  return node
}
function claimElementTree(root) {
  root.querySelectorAll?.("a[href],form[action]")?.forEach(claimElement)
  return root
}

function dynamicProperty(props, key) {
  return () => props[key]
}

function applyRef(ref, element) {
  const list = Array.isArray(ref) ? ref : [ref]
  for (const fn of list) if (typeof fn === "function") fn(element)
}

function ref(fn, element) {
  applyRef(fn(), element)
}

function useHead(tag) {
  const tags = typeof tag === "function" ? tag() : tag
  headTags.push(tags)
}

function acquireAsset(descriptor) {
  assets.set(descriptor, (assets.get(descriptor) ?? 0) + 1)
  return () => {
    const count = (assets.get(descriptor) ?? 1) - 1
    if (count <= 0) assets.delete(descriptor)
    else assets.set(descriptor, count)
  }
}

function warmAsset(descriptor) {
  if (descriptor?.type === "style" || descriptor?.type === "module") {
    return { loadState: "loaded", loadPromise: Promise.resolve() }
  }
}

function HydrationScript() {
  return null
}

function generateHydrationScript() {
  return `<script>window._$HY=window._$HY||{events:[],completed:new WeakSet};</script>`
}

function getRequestEvent() {
  return requestEvent
}

function createRequestEvent(request = new Request("http://localhost"), locals = {}) {
  requestEvent = { request, locals, response: createResponseStub() }
  return requestEvent
}

function createResponseStub() {
  return { headers: new Headers(), committed: false }
}

function commitResponseStub(stub) {
  if (stub) stub.committed = true
}

function commitEventResponse(event) {
  commitResponseStub(event?.response)
}

function createSSRResponse(body, init) {
  return new Response(body, init)
}

function createLiveHoles() {
  return []
}

function composeMiddleware(...handlers) {
  return (event) => handlers.reduce((next, handler) => () => handler(event, next), () => {})()
}

function parseCookieHeader(header) {
  const map = new Map()
  if (!header) return map
  for (const part of String(header).split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (!name) continue
    const value = rest.join("=")
    try {
      map.set(decodeURIComponent(name), decodeURIComponent(value.replace(/^"|"$/g, "")))
    } catch {
      map.set(name, value)
    }
  }
  return map
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? "/"}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  if (options.maxAge != null) parts.push(`Max-Age=${Math.trunc(options.maxAge)}`)
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.httpOnly) parts.push("HttpOnly")
  if (options.secure) parts.push("Secure")
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  return parts.join("; ")
}

function hasFlashCookie() {
  return false
}
function clearFlashCookie() {}
function isServerFunction() {
  return false
}
function getServerFunctionMetadata() {}
function getServerFunctionRPC() {}

function isHref() {
  return false
}
function isResponseEnvelope(value) {
  return value && value[ResponseEnvelope]
}
const ResponseEnvelope = Symbol("solid.ResponseEnvelope")
function isSafeError(error) {
  return Boolean(error?.[SAFE_ERROR])
}
function markSafeError(error) {
  if (error && typeof error === "object") error[SAFE_ERROR] = true
  return error
}
function getExpectedRedirectStatus() {
  return 302
}
function redirect(url, status = 302) {
  const response = { url, status, [ResponseEnvelope]: true }
  return response
}
function reload() {
  if (typeof location !== "undefined") location.reload()
}
function respond(body, init) {
  return new Response(body, init)
}

function escape(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
}

function stringifyNode(value) {
  if (value == null || value === false || value === true) return ""
  if (typeof value === "function") return stringifyNode(value())
  if (typeof value === "string" || typeof value === "number") return escape(value)
  if (Array.isArray(value)) return value.map(stringifyNode).join("")
  if (typeof document !== "undefined" && value instanceof Node) {
    const host = document.createElement("div")
    host.appendChild(value.cloneNode(true))
    return host.innerHTML
  }
  return String(value ?? "")
}

function renderToString(code) {
  if (typeof document !== "undefined") {
    const host = document.createElement("div")
    const dispose = render(code, host)
    const html = host.innerHTML
    dispose()
    return html
  }
  return stringifyNode(typeof code === "function" ? code() : code)
}

function renderToStream(code) {
  const html = renderToString(code)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(html)
      controller.close()
    },
  })
}

function ssr(template, ...values) {
  if (typeof template === "string") return template
  return template.reduce((html, part, index) => html + part + (values[index] ?? ""), "")
}

function ssrElement(tag, props, children, selfClose) {
  const attributes = typeof props === "function" ? props() : props ?? {}
  const attr = Object.entries(attributes)
    .filter(([, value]) => value != null && value !== false)
    .map(([name, value]) => ` ${name}="${escape(value === true ? "" : value)}"`)
    .join("")
  const inner = typeof children === "function" ? children() : children ?? ""
  if (selfClose || VoidElements.has(tag)) return `<${tag}${attr}>`
  return `<${tag}${attr}>${inner}</${tag}>`
}

function ssrAttribute(name, value) {
  if (value == null || value === false) return ""
  return ` ${name}="${escape(value === true ? "" : value)}"`
}

function ssrClassName(value) {
  return value ? ` class="${escape(value)}"` : ""
}

function ssrStyle(value) {
  if (!value) return ""
  const text = typeof value === "string"
    ? value
    : Object.entries(value).filter(([, next]) => next != null).map(([name, next]) => `${name}:${next}`).join(";")
  return text ? ` style="${escape(text)}"` : ""
}

function ssrStyleProperty(name, value) {
  return value == null ? "" : `${name}:${value};`
}

function ssrHydrationKey() {
  return ` data-hk="${getHydrationKey()}"`
}

function ssrGroup(value) {
  return stringifyNode(value)
}

void lil

return {ChildProperties, DOMElements, DOMWithState, DelegatedEvents, Errored, For, Hydration, Loading, Match, MathMLElements, Namespaces, NoHydration, RawTextElements, Repeat, Reveal, SVGElements, Show, Switch, VoidElements, children, createComponent, getOwner, untrack, HREF, SAFE_ERROR, RequestContext, REVALIDATE_HEADER, isServer, isDev, render, hydrate, insert, template, getHydrationKey, getNextElement, getNextMatch, getNextMarker, runHydrationEvents, Portal, dynamic, Dynamic, clientOnly, httpStatus, httpHeader, effect, memo, scope, mergeProps, spread, assign, setAttribute, setAttributeNS, className, setProperty, setStyleProperty, style, addEvent, delegateEvents, registerDelegatedRoot, unregisterDelegatedRoot, registerDelegatedContainer, unregisterDelegatedContainer, getDelegatedRoot, registerElementClaim, claimElement, claimElementTree, dynamicProperty, applyRef, ref, useHead, acquireAsset, warmAsset, HydrationScript, generateHydrationScript, getRequestEvent, createRequestEvent, createResponseStub, commitResponseStub, commitEventResponse, createSSRResponse, createLiveHoles, composeMiddleware, parseCookieHeader, serializeCookie, hasFlashCookie, clearFlashCookie, isServerFunction, getServerFunctionMetadata, getServerFunctionRPC, isHref, isResponseEnvelope, ResponseEnvelope, isSafeError, markSafeError, getExpectedRedirectStatus, redirect, reload, respond, escape, renderToString, renderToStream, ssr, ssrElement, ssrAttribute, ssrClassName, ssrStyle, ssrStyleProperty, ssrHydrationKey, ssrGroup};
}
