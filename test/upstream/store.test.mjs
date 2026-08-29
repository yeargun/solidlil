import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const compiler = process.env.SOLIDLIL_LILSCRIPT_BIN ?? resolve(root, "../lilscript/target/release/lilscript");
const storeRoot = join(root, "src/upstream/solid-signals/src/store");
const mirroredFiles = [
  "index.lil",
  "optimistic.lil",
  "projection.lil",
  "reconcile.lil",
  "store.lil",
  "storePath.lil",
  "utils.lil",
];
const publicExports = [
  "$PROXY",
  "$TARGET",
  "$TRACK",
  "createOptimisticStore",
  "createProjection",
  "createStore",
  "deep",
  "isWrappable",
  "merge",
  "omit",
  "reconcile",
  "snapshot",
  "storePath",
];

let output;
let candidate;
let candidateOptimized;
let reference;

function compile(mode, name, optimized = false) {
  const target = join(output, `${name}.mjs`);
  const args = [
    join(root, "test/upstream/store-entry.lil"),
    "--target", "js-module",
    "--mode", mode,
    "--output", target,
  ];
  args.push(
    "--config",
    join(root, optimized ? "test/upstream/exact-production.toml" : "test/upstream/dom-web-oracle.toml"),
  );
  const result = spawnSync(compiler, args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return target;
}

before(async () => {
  assert.equal(existsSync(compiler), true, `LilScript compiler not found at ${compiler}`);
  const outputRoot = join(root, "test-output");
  await mkdir(outputRoot, { recursive: true });
  output = await mkdtemp(join(outputRoot, "store-"));
  const development = compile("development", "candidate");
  const optimized = compile("production", "candidate-optimized", true);

  const referencePath = join(output, "reference.mjs");
  await build({
    stdin: {
      contents: `
export * from "./upstream/solid/packages/solid-signals/src/store/index.ts";
export { createMemo as __createMemo, createSignal as __createSignal } from "./upstream/solid/packages/solid-signals/src/signals.ts";
export { flush as __flush } from "./upstream/solid/packages/solid-signals/src/core/index.ts";
`,
      loader: "ts",
      resolveDir: root,
    },
    outfile: referencePath,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    define: { __DEV__: "false", __TEST__: "false" },
  });

  const nonce = `${Date.now()}-${process.pid}`;
  candidate = await import(`${pathToFileURL(development).href}?${nonce}`);
  candidateOptimized = await import(`${pathToFileURL(optimized).href}?${nonce}`);
  reference = await import(`${pathToFileURL(referencePath).href}?${nonce}`);
});

after(async () => {
  if (output) await rm(output, { recursive: true, force: true });
});

test("all seven pinned store modules are implemented in LilScript without runtime facades", async () => {
  for (const relative of mirroredFiles) {
    const source = await readFile(join(storeRoot, relative), "utf8");
    assert.ok(source.length > 0, `${relative} is empty`);
    assert.doesNotMatch(source, /(?:^|\/)reactive(?:\/|\")/, `${relative} imports the prototype`);
    assert.doesNotMatch(source, /from\s+["'][^"']+\.(?:js|mjs|cjs)["']/, `${relative} imports JavaScript logic`);
  }

  const kernel = await readFile(join(storeRoot, "_kernel.lil"), "utf8");
  assert.doesNotMatch(kernel, /@solidjs\/signals/);
  const blockers = await readFile(join(root, "test/upstream/store-BLOCKERS.md"), "utf8");
  assert.doesNotMatch(blockers, /npm primitive bridge/);
  assert.match(blockers, /verifiedFiles/);

  const lock = JSON.parse(await readFile(join(root, "upstream.lock.json"), "utf8"));
  for (const relative of mirroredFiles) {
    const upstreamPath = `packages/solid-signals/src/store/${relative.replace(/\.lil$/, ".ts")}`;
    assert.equal(lock.verifiedFiles.includes(upstreamPath), false, `${upstreamPath} cannot be verified with npm hooks`);
  }
});

test("the store entry compiles as development and production reusable ESM", () => {
  assert.equal(existsSync(join(output, "candidate.mjs")), true);
  assert.equal(existsSync(join(output, "candidate-optimized.mjs")), true);
});

test("the public store surface and function arities match the pinned source", () => {
  for (const implementation of [candidate, candidateOptimized]) {
    assert.deepEqual(
      Object.keys(implementation).filter(name => !name.startsWith("__")).sort(),
      publicExports.slice().sort(),
    );
    for (const name of publicExports) {
      assert.equal(typeof implementation[name], typeof reference[name], name);
      if (typeof implementation[name] === "function") {
        assert.equal(implementation[name].length, reference[name].length, `${name}.length`);
      }
    }
  }
});

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

function runScenario(api, support) {
  const result = {
    wrappable: [
      api.isWrappable({}),
      api.isWrappable([]),
      api.isWrappable(new Date()),
      api.isWrappable(Object.freeze({})),
      api.isWrappable(null),
    ],
  };

  const [store, setStore] = api.createStore({
    a: 1,
    nested: { b: 2, obsolete: true },
    rows: [{ id: 1, value: "a" }, { id: 2, value: "b" }],
    removed: true,
  });
  const nestedIdentity = store.nested;
  const movedIdentity = store.rows[1];
  const deepValue = support.createMemo(() => api.deep(store).nested.b);
  result.initial = [deepValue(), json(api.snapshot(store))];

  setStore(draft => {
    draft.a = 3;
    draft.nested.b = 4;
    draft.rows.push({ id: 3, value: "c" });
    delete draft.removed;
  });
  result.staged = [
    [store.a, store.nested.b, store.rows.length, "removed" in store],
    json(api.snapshot(store)),
  ];
  support.flush();
  result.committed = [
    [
      store.a,
      store.nested.b,
      store.rows.length,
      "removed" in store,
      deepValue(),
      store.nested === nestedIdentity,
      store.rows[1] === movedIdentity,
    ],
    json(api.snapshot(store)),
  ];

  setStore(api.storePath("nested", "b", value => value + 1));
  setStore(api.storePath("nested", "obsolete", api.storePath.DELETE));
  setStore(api.storePath("rows", [0, 2], "value", "x"));
  setStore(api.storePath("rows", row => row.id === 2, "value", "y"));
  setStore(api.storePath("rows", { from: 0, to: 2, by: 2 }, "value", value => `${value}!`));
  support.flush();
  result.paths = json(api.snapshot(store));

  setStore(api.reconcile({
    a: 8,
    nested: { b: 9 },
    rows: [{ id: 2, value: "B" }, { id: 1, value: "A" }],
  }));
  support.flush();
  result.reconciled = [json(api.snapshot(store)), store.rows[0] === movedIdentity];

  const [source, setSource] = support.createSignal(1);
  const merged = api.merge({ stable: "yes" }, () => ({ value: source() }));
  const omitted = api.omit(merged, "stable");
  result.mergedInitial = [merged.value, omitted.value, "stable" in omitted, Reflect.ownKeys(omitted)];
  setSource(2);
  support.flush();
  result.mergedUpdated = [merged.value, omitted.value];

  const projected = api.createProjection(() => ({ value: source() }), { value: 0 });
  const [derived] = api.createStore(() => ({ value: source() }), { value: 0 });
  result.projectedInitial = [projected.value, derived.value];
  setSource(3);
  support.flush();
  result.projectedUpdated = [projected.value, derived.value];

  const [optimistic, setOptimistic] = api.createOptimisticStore({ value: 1, keep: true });
  setOptimistic(draft => {
    draft.value = 2;
    delete draft.keep;
    draft.added = 1;
  });
  result.optimisticPending = [
    optimistic.value,
    "keep" in optimistic,
    "added" in optimistic,
    json(api.snapshot(optimistic)),
  ];
  support.flush();
  result.optimisticSettled = [
    optimistic.value,
    "keep" in optimistic,
    "added" in optimistic,
    json(api.snapshot(optimistic)),
  ];
  setOptimistic(draft => {
    draft.value += 1;
  });
  result.optimisticSecondPending = [optimistic.value, json(api.snapshot(optimistic))];
  support.flush();
  result.optimisticSecondSettled = [optimistic.value, json(api.snapshot(optimistic))];

  const marker = Symbol("marker");
  const [symbolStore, setSymbolStore] = api.createStore({ [marker]: 1 });
  setSymbolStore(draft => {
    draft[marker] = 2;
  });
  result.symbol = [symbolStore[marker], api.snapshot(symbolStore)[marker]];
  support.flush();
  result.symbol.push(symbolStore[marker], api.snapshot(symbolStore)[marker]);

  const firstShallowChild = { value: 1 };
  const [shallow, setShallow] = api.createStore({ child: firstShallowChild }, { shallow: true });
  setShallow(draft => {
    draft.child = { value: 2 };
  });
  result.shallowPending = [shallow.child === firstShallowChild, api.snapshot(shallow).child.value];
  support.flush();
  result.shallowSettled = [shallow.child === firstShallowChild, shallow.child.value];

  const cycle = { name: "root" };
  cycle.self = cycle;
  const [cyclicStore] = api.createStore(cycle);
  const cyclicSnapshot = api.snapshot(cyclicStore);
  result.cycle = [cyclicSnapshot !== cyclicStore, cyclicSnapshot.self === cyclicSnapshot];

  return result;
}

test("store behavior matches the pinned local Solid source", () => {
  const expected = runScenario(reference, {
    createMemo: reference.__createMemo,
    createSignal: reference.__createSignal,
    flush: reference.__flush,
  });
  const actual = runScenario(candidate, {
    createMemo: candidate.__createMemo,
    createSignal: candidate.__createSignal,
    flush: candidate.__flush,
  });
  const optimized = runScenario(candidateOptimized, {
    createMemo: candidateOptimized.__createMemo,
    createSignal: candidateOptimized.__createSignal,
    flush: candidateOptimized.__flush,
  });
  assert.deepEqual(actual, expected);
  assert.deepEqual(optimized, expected);
});
