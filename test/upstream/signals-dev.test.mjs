import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const compiler = process.env.SOLIDLIL_LILSCRIPT_BIN ?? resolve(root, "../lilscript/target/release/lilscript");

let output;
let api;

before(async () => {
  assert.equal(existsSync(compiler), true, `LilScript compiler not found at ${compiler}`);
  await mkdir(join(root, ".tmp"), { recursive: true });
  output = await mkdtemp(join(root, ".tmp/signals-dev-"));
  const target = join(output, "runtime.mjs");
  const result = spawnSync(compiler, [
    resolve(root, "test/upstream/signals-dev-runtime.lil"),
    "--target", "js-module",
    "--mode", "development",
    "--output", target,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  api = await import(`${pathToFileURL(target).href}?${Date.now()}`);
});

after(async () => {
  if (output) await rm(output, { recursive: true, force: true });
});

test("DEV exposes graph traversal and owner/graph/update hooks", () => {
  assert.deepEqual(Object.keys(api.DEV), [
    "hooks", "diagnostics", "getChildren", "getSignals", "getParent", "getSources", "getObservers",
  ]);

  const owners = [];
  const graphs = [];
  let updates = 0;
  api.DEV.hooks.onOwner = owner => owners.push(owner);
  api.DEV.hooks.onGraph = (value, owner) => graphs.push([value, owner]);
  api.DEV.hooks.onUpdate = () => updates++;

  let owner;
  let source;
  let memo;
  let setSource;
  const dispose = api.createRoot(disposeRoot => {
    owner = api.getOwner();
    [source, setSource] = api.createSignal(1);
    memo = api.createMemo(() => source() * 2);
    return disposeRoot;
  });

  const sourceNode = source[api.$REFRESH];
  const memoNode = memo[api.$REFRESH];
  assert.equal(graphs.length, 1);
  assert.equal(graphs[0][0], sourceNode);
  assert.equal(graphs[0][1], owner);
  assert.equal(sourceNode._owner, owner);
  assert.deepEqual(api.getSignals(owner), [sourceNode]);
  assert.deepEqual(api.DEV.getSignals(owner), [sourceNode]);
  const signalSnapshot = api.DEV.getSignals(owner);
  signalSnapshot.length = 0;
  assert.deepEqual(api.DEV.getSignals(owner), [sourceNode]);
  assert.equal(api.DEV.getParent(memoNode), owner);
  assert.equal(api.DEV.getParent(owner), null);
  assert.deepEqual(api.DEV.getChildren(owner), [memoNode]);
  assert.deepEqual(api.DEV.getSources(memoNode), [sourceNode]);
  assert.deepEqual(api.DEV.getObservers(sourceNode), [memoNode]);
  assert.equal(owners.includes(owner), true);
  assert.equal(owners.includes(memoNode), true);

  setSource(2);
  api.flush();
  assert.equal(updates > 0, true);
  api.clearSignals(owner);
  assert.deepEqual(api.DEV.getSignals(owner), []);
  dispose();
  assert.deepEqual(api.DEV.getSignals(owner), []);
});

test("DEV store graph and update hooks observe public store writes", () => {
  const graphs = [];
  const updates = [];
  api.DEV.hooks.onGraph = (value, owner) => graphs.push([value, owner]);
  api.DEV.hooks.onStoreNodeUpdate = (...args) => updates.push(args);

  let owner;
  const dispose = api.createRoot(disposeRoot => {
    owner = api.getOwner();
    const [store, setStore] = api.createStore({ count: 1 });
    setStore(state => {
      state.count = 2;
    });
    api.flush();
    assert.equal(store.count, 2);
    return disposeRoot;
  });

  assert.equal(graphs.length, 1);
  assert.equal(graphs[0][1], owner);
  assert.deepEqual(api.DEV.getSignals(owner), [graphs[0][0]]);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].slice(1), ["count", 2, 1]);
  dispose();
});

test("strict untracked reads emit capturable diagnostics", () => {
  const capture = api.DEV.diagnostics.capture();
  const subscribed = [];
  const unsubscribe = api.DEV.diagnostics.subscribe(event => subscribed.push(event));
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const [source] = api.createSignal(1);
    assert.equal(api.untrack(() => source(), "component Test"), 1);
  } finally {
    console.warn = previousWarn;
    unsubscribe();
  }

  assert.equal(warnings.length, 1);
  assert.equal(capture.events.length, 1);
  assert.equal(subscribed.length, 1);
  assert.equal(capture.events[0].code, "STRICT_READ_UNTRACKED");
  assert.equal(capture.events[0].kind, "strict-read");
  assert.equal(capture.events[0].severity, "warn");
  assert.equal(capture.events[0].data.strictRead, "component Test");
  assert.match(capture.events[0].message, /will not update/);
  const stopped = capture.stop();
  assert.deepEqual(stopped, capture.events);
  assert.notEqual(stopped, capture.events);
});

test("pending strict reads throw the upstream diagnostic error", () => {
  const capture = api.DEV.diagnostics.capture();
  const pending = new Promise(() => {});
  const memo = api.createMemo(() => pending);
  assert.throws(
    () => api.untrack(() => memo(), "component Async"),
    /\[PENDING_ASYNC_UNTRACKED_READ\].*component Async/,
  );
  assert.equal(capture.events.length, 1);
  assert.equal(capture.events[0].code, "PENDING_ASYNC_UNTRACKED_READ");
  capture.clear();
  assert.deepEqual(capture.events, []);
  assert.deepEqual(capture.stop(), []);
});

test("development invariant hooks report each represented state violation", () => {
  for (const [name, invariant] of [
    ["triggerPendingProbeInvariant", "INV-1"],
    ["triggerAsyncReporterInvariant", "INV-3"],
    ["triggerHeldPendingInvariant", "INV-7"],
    ["triggerOptimisticInvariant", "INV-2"],
    ["triggerAffectsInvariant", "INV-10"],
    ["triggerMergedLaneInvariant", "INV-5"],
  ]) {
    const capture = api.DEV.diagnostics.capture();
    assert.throws(() => api[name](), new RegExp(`\\[INVARIANT_VIOLATION\\] ${invariant}:`));
    assert.equal(capture.events.at(-1).code, "INVARIANT_VIOLATION");
    assert.equal(capture.events.at(-1).data.invariant, invariant);
    capture.stop();
  }
  assert.equal(api.allowedAsyncReporterWrite(), 1);
});
