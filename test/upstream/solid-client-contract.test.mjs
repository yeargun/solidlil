import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = join(root, "src/upstream/solid/src");
const files = [
  "index.lil",
  "client/component.lil",
  "client/core.lil",
  "client/flow.lil",
  "client/hydration.lil",
];

test("the five pinned Solid client modules have source-aligned LilScript files", async () => {
  for (const relative of files) {
    const source = await readFile(join(sourceRoot, relative), "utf8");
    assert.ok(source.length > 0, `${relative} is empty`);
    assert.doesNotMatch(source, /import\s+extern/, `${relative} imports a JS facade`);
    assert.doesNotMatch(source, /\.\.\/\.\.\/\.\.\/reactive/, `${relative} imports the prototype`);
  }
});

test("the client index retains the pinned runtime export surface", async () => {
  const source = await readFile(join(sourceRoot, "index.lil"), "utf8");
  const expected = [
    "$PROXY", "$REFRESH", "$TRACK", "action", "affects", "children",
    "createComponent", "createContext", "createEffect", "createErrorBoundary",
    "createLoadingBoundary", "createMemo", "createOptimistic",
    "createOptimisticStore", "createOwner", "createProjection", "createReaction",
    "createRenderEffect", "createRoot", "createSignal", "createStore",
    "createTrackedEffect", "createUniqueId", "creationStamp", "deep", "DEV",
    "enableExternalSource", "enableHydration", "enforceLoadingBoundary", "Errored",
    "flatten", "flush", "For", "getNextChildId", "getObserver", "getOwner",
    "getProjectionTrace", "Hydration", "inServerComponentScope", "isDisposed",
    "isEqual", "isPending", "isWrappable", "latest", "lazy", "Loading",
    "mapArray", "Match", "materializeContainerTrace", "merge", "NoHydrateContext",
    "NoHydration", "NotReadyError", "omit", "onCleanup", "onSettled", "reconcile", "refresh",
    "Repeat", "repeat", "resolve", "Reveal", "runInServerComponentScope",
    "runWithOwner", "sharedConfig", "Show", "snapshot", "ssrHandleError",
    "ssrScope", "storePath", "Switch", "untrack", "useContext",
  ];
  for (const name of expected) {
    assert.match(source, new RegExp(`(?<![A-Za-z0-9_$])${name.replace("$", "\\$")}(?![A-Za-z0-9_$])`));
  }
});

test("client submodules retain their runtime exports", async () => {
  const expectedByFile = {
    "client/component.lil": ["createComponent", "lazy", "createUniqueId"],
    "client/core.lil": [
      "IS_DEV", "$DEVCOMP", "createContext", "useContext", "children", "devComponent",
    ],
    "client/flow.lil": [
      "For", "Repeat", "Show", "Switch", "Match", "Errored", "Loading", "Reveal",
    ],
    "client/hydration.lil": [
      "NoHydrateContext", "sharedConfig", "_lazyHydrationLookup",
      "materializeContainerTrace", "enableHydration", "createMemo", "createSignal",
      "createErrorBoundary", "createRevealOrder", "createOptimistic", "createProjection",
      "createStore", "createOptimisticStore", "createRenderEffect", "createEffect",
      "createLoadingBoundary", "NoHydration", "Hydration",
    ],
  };
  for (const [relative, names] of Object.entries(expectedByFile)) {
    const source = await readFile(join(sourceRoot, relative), "utf8");
    for (const name of names) {
      assert.match(
        source,
        new RegExp(`export(?:\\s+[A-Za-z][A-Za-z0-9<>]*)?\\s+(?:constructor\\s+)?${name.replace("$", "\\$")}\\b|export\\s*\\{[^}]*${name.replace("$", "\\$")}`, "s"),
        `${relative} does not export ${name}`,
      );
    }
  }
});

test("the source-aligned client compile entry links when signals are available", async (t) => {
  const signals = join(root, "src/upstream/solid-signals/src/index.lil");
  if (!existsSync(signals)) {
    t.skip("blocked: src/upstream/solid-signals/src/index.lil is assigned separately and not present");
    return;
  }
  const compiler = resolve(root, "../lilscript/target/release/lilscript");
  assert.ok(existsSync(compiler), `missing compiler: ${compiler}`);
  const output = join(root, "test/upstream/.solid-client-compile.mjs");
  const result = spawnSync(
    compiler,
    [
      join(root, "test/upstream/solid-client-compile.lil"),
      "--target", "js-module",
      "--mode", "development",
      "--output", output,
    ],
    { cwd: root, encoding: "utf8" },
  );
  await rm(output, { force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
