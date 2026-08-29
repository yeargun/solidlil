import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const compiler = process.env.SOLIDLIL_LILSCRIPT_BIN ?? resolve(root, "../lilscript/target/release/lilscript");
const sourceRoot = join(root, "src/upstream/solid-signals/src");
const coreFiles = [
  "action", "async", "constants", "context", "core", "dev", "effect", "error", "external",
  "graph", "heap", "index", "invariants", "lanes", "optimistic", "owner", "scheduler", "verdict",
];
const topFiles = ["affects", "boundaries", "index", "map", "signals"];

let output;
const builds = new Map();

function compile(input, name, mode, config) {
  const target = join(output, `${name}.mjs`);
  const args = [
    resolve(root, input),
    "--target", "js-module",
    "--mode", mode,
    "--output", target,
  ];
  if (config) args.push("--config", resolve(root, config));
  const result = spawnSync(compiler, args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  builds.set(name, target);
}

before(async () => {
  assert.equal(existsSync(compiler), true, `LilScript compiler not found at ${compiler}`);
  await mkdir(join(root, ".tmp"), { recursive: true });
  output = await mkdtemp(join(root, ".tmp/signals-"));
  for (const [mode, suffix, config] of [
    ["development", "dev", undefined],
    ["production", "prod", "test/upstream/exact-production.toml"],
  ]) {
    compile("test/upstream/signals-runtime.lil", `runtime-${suffix}`, mode, config);
    if (suffix === "dev") compile("src/upstream/solid-signals/src/index.lil", "public-dev", mode, config);
  }
});

after(async () => {
  if (output) await rm(output, { recursive: true, force: true });
});

test("all 23 pinned core and top-level modules are typed LilScript", async () => {
  const files = [
    ...coreFiles.map(name => `core/${name}.lil`),
    ...topFiles.map(name => `${name}.lil`),
  ];
  assert.equal(files.length, 23);
  const lock = JSON.parse(await readFile(join(root, "upstream.lock.json"), "utf8"));
  const pinnedFiles = lock.solid.files
    .filter(path => /^packages\/solid-signals\/src\/(?:core\/|(?:affects|boundaries|index|map|signals)\.ts$)/.test(path))
    .map(path => path.replace("packages/solid-signals/src/", "").replace(/\.ts$/, ".lil"))
    .sort();
  assert.deepEqual(files.slice().sort(), pinnedFiles);
  for (const relative of files) {
    const source = await readFile(join(sourceRoot, relative), "utf8");
    assert.ok(source.length > 0, `${relative} is empty`);
    assert.doesNotMatch(source, /import\s+extern/, `${relative} imports a JavaScript facade`);
    assert.doesNotMatch(source, /@solidjs\/signals/, `${relative} imports the npm implementation`);
    assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/reactive/, `${relative} imports the prototype runtime`);
  }
  const installed = JSON.parse(
    await readFile(join(root, "node_modules/@solidjs/signals/package.json"), "utf8"),
  );
  const pinned = JSON.parse(
    await readFile(join(root, "upstream/solid/packages/solid-signals/package.json"), "utf8"),
  );
  assert.equal(installed.version, pinned.version);
});

test("runtime entries compile in development and production", async () => {
  for (const name of ["runtime-dev", "public-dev", "runtime-prod"]) {
    assert.equal(existsSync(builds.get(name)), true, name);
  }
  assert.doesNotMatch(await readFile(builds.get("runtime-dev"), "utf8"), /@solidjs\/signals/);
  assert.doesNotMatch(await readFile(builds.get("runtime-prod"), "utf8"), /@solidjs\/signals/);
});

async function load(path, tag) {
  return import(`${pathToFileURL(path).href}?${tag}-${Date.now()}`);
}

async function synchronousSnapshot(api) {
  const result = {};

  const [count, setCount] = api.createSignal(1);
  const doubled = api.createMemo(() => count() * 2);
  result.values = [count(), doubled()];
  setCount(value => value + 1);
  setCount(value => value + 1);
  api.flush();
  result.values.push(count(), doubled());
  const [writable, setWritable] = api.createSignal(() => count() * 10);
  result.writable = [writable()];
  setWritable(99);
  api.flush();
  result.writable.push(writable());
  setCount(4);
  api.flush();
  result.writable.push(writable());

  const effectLog = [];
  let rootCleanup = 0;
  const effectScope = api.createRoot(disposeRoot => {
    const [source, setSource] = api.createSignal(0);
    api.onCleanup(() => {
      rootCleanup++;
    });
    api.createRenderEffect(
      () => source(),
      (value, previous) => {
        effectLog.push(["render", value, previous]);
      },
    );
    api.createEffect(
      () => source(),
      (value, previous) => {
        effectLog.push(["user", value, previous]);
      },
    );
    api.flush();
    return { disposeRoot, setSource };
  });
  effectScope.setSource(2);
  api.flush();
  effectScope.disposeRoot();
  result.effects = effectLog;
  result.rootCleanup = rootCleanup;

  const context = api.createContext("default", "differential");
  result.context = api.createRoot(() => {
    const before = api.getContext(context);
    api.setContext(context, "provided");
    const nested = api.createRoot(() => api.getContext(context));
    return [before, api.getContext(context), nested];
  });

  const [items, setItems] = api.createSignal([
    { id: 1, label: "one" },
    { id: 2, label: "two" },
  ]);
  let maps = 0;
  const mapped = api.mapArray(
    items,
    (item, index) => ({ token: ++maps, item, index }),
    { keyed: item => item.id },
  );
  const first = mapped();
  setItems([
    { id: 2, label: "TWO" },
    { id: 1, label: "ONE" },
    { id: 3, label: "three" },
  ]);
  api.flush();
  const second = mapped();
  result.map = {
    maps,
    reused: [second[0] === first[1], second[1] === first[0]],
    rows: second.map(row => [row.token, row.item().label, row.index()]),
  };

  const [indexedItems, setIndexedItems] = api.createSignal(["a", "b"]);
  let indexedMaps = 0;
  const indexed = api.mapArray(
    indexedItems,
    (item, index) => ({ token: ++indexedMaps, item, index }),
    { keyed: false },
  );
  const indexedFirst = indexed();
  setIndexedItems(["A", "B", "C"]);
  api.flush();
  const indexedSecond = indexed();
  result.indexed = {
    maps: indexedMaps,
    reused: [indexedSecond[0] === indexedFirst[0], indexedSecond[1] === indexedFirst[1]],
    rows: indexedSecond.map(row => [row.token, row.item(), row.index]),
  };

  const [length, setLength] = api.createSignal(2);
  let repeats = 0;
  const repeated = api.repeat(length, index => ({ token: ++repeats, index }));
  const repeatFirst = repeated();
  setLength(4);
  api.flush();
  const repeatSecond = repeated();
  result.repeat = {
    repeats,
    reused: [repeatSecond[0] === repeatFirst[0], repeatSecond[1] === repeatFirst[1]],
    rows: repeatSecond.map(row => [row.token, row.index]),
  };

  result.flatten = api.flatten([1, [() => 2, null, false, ""], 3], { skipNonRendered: true });
  const errorBoundary = api.createRoot(() => api.createErrorBoundary(
    () => {
      throw new Error("expected");
    },
    error => `caught:${error().message}`,
  ));
  result.errorBoundary = errorBoundary();
  let settled = 0;
  api.onSettled(() => {
    settled++;
  });
  api.flush();
  result.settled = settled;
  result.equality = [api.isEqual(1, 1), api.isEqual({}, {})];
  return result;
}

async function asynchronousSnapshot(api) {
  let releaseMemo;
  const pendingMemo = new Promise(resolve => {
    releaseMemo = resolve;
  });
  const memo = api.createMemo(() => pendingMemo);
  let threw = false;
  try {
    memo();
  } catch {
    threw = true;
  }
  const boundary = api.createRoot(() => api.createLoadingBoundary(() => memo(), () => "loading"));
  const asyncState = [threw, api.isPending(() => memo()), boundary()];
  releaseMemo("ready");
  await pendingMemo;
  await Promise.resolve();
  api.flush();
  asyncState.push(boundary(), memo(), api.isPending(() => memo()));

  let releaseAction;
  const wait = new Promise(resolve => {
    releaseAction = resolve;
  });
  const [source] = api.createSignal(2);
  let derived;
  const disposeDerived = api.createRoot(dispose => {
    derived = api.createMemo(() => source() * 3);
    derived();
    return dispose;
  });
  const marked = api.action(function* (amount) {
    api.affects(source);
    yield wait;
    return amount * 2;
  });
  const markedTask = marked(4);
  const affectsState = [api.isPending(() => source()), api.isPending(() => derived())];
  releaseAction();
  affectsState.push(await markedTask);
  api.flush();
  affectsState.push(api.isPending(() => source()), api.isPending(() => derived()));
  disposeDerived();

  let releaseOptimistic;
  const optimisticWait = new Promise(resolve => {
    releaseOptimistic = resolve;
  });
  const [optimistic, setOptimistic] = api.createOptimistic("base");
  const mutate = api.action(function* () {
    setOptimistic("draft");
    yield optimisticWait;
    return "complete";
  });
  const optimisticTask = mutate();
  const optimisticState = [optimistic()];
  releaseOptimistic();
  optimisticState.push(await optimisticTask);
  api.flush();
  optimisticState.push(optimistic());

  return { asyncState, affectsState, optimisticState };
}

test("public surface matches the pinned installed reference", async () => {
  const candidate = await load(builds.get("public-dev"), "public-dev");
  const reference = await load(join(root, "node_modules/@solidjs/signals/dist/dev.js"), "reference-keys-dev");
  assert.equal(Object.keys(candidate).length, 61);
  assert.deepEqual(Object.keys(candidate).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) {
    if (typeof reference[name] === "function" && typeof candidate[name] === "function") {
      assert.equal(candidate[name].length, reference[name].length, `${name}.length`);
    }
  }
});

for (const variant of ["dev", "prod"]) {

  test(`${variant} synchronous signals, owners, effects, mapping, and flatten match`, async () => {
    const candidate = await load(builds.get(`runtime-${variant}`), `candidate-sync-${variant}`);
    const referencePath = variant === "dev"
      ? join(root, "node_modules/@solidjs/signals/dist/dev.js")
      : join(root, "node_modules/@solidjs/signals/dist/prod/index.js");
    const reference = await load(referencePath, `reference-sync-${variant}`);
    assert.deepEqual(await synchronousSnapshot(candidate), await synchronousSnapshot(reference));
  });

  test(`${variant} async, affects, action, and optimistic behavior match`, async () => {
    const candidate = await load(builds.get(`runtime-${variant}`), `candidate-async-${variant}`);
    const referencePath = variant === "dev"
      ? join(root, "node_modules/@solidjs/signals/dist/dev.js")
      : join(root, "node_modules/@solidjs/signals/dist/prod/index.js");
    const reference = await load(referencePath, `reference-async-${variant}`);
    assert.deepEqual(await asynchronousSnapshot(candidate), await asynchronousSnapshot(reference));
  });
}
