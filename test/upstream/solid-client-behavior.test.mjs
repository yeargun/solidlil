import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const compiler = process.env.SOLIDLIL_LILSCRIPT_BIN
  ?? resolve(root, "../lilscript/target/release/lilscript");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const variants = [
  {
    name: "development",
    mode: "development",
    config: "test/upstream/dom-web-oracle.toml",
    conditions: ["browser", "development", "import"],
  },
  {
    name: "production",
    mode: "production",
    config: "test/upstream/exact-production.toml",
    conditions: ["browser", "import"],
  },
];

let output;
let browser;

function compileCandidate(variant) {
  const target = join(output, `candidate-${variant.name}.mjs`);
  execFileSync(
    compiler,
    [
      resolve(root, "test/upstream/solid-client-behavior-entry.lil"),
      "--target", "js-module",
      "--config", resolve(root, variant.config),
      "--mode", variant.mode,
      "--output", target,
    ],
    { cwd: root, stdio: "pipe" },
  );
  return target;
}

async function buildReference(variant) {
  const target = join(output, `reference-${variant.name}.mjs`);
  await build({
    stdin: {
      contents: 'export * from "solid-js";',
      loader: "js",
      resolveDir: root,
    },
    outfile: target,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    conditions: variant.conditions,
  });
  return target;
}

async function buildBrowserBundle(input, globalName, candidate, variant) {
  const target = join(output, `${globalName}.js`);
  const contents = candidate
    ? `import { behaviorApi } from ${JSON.stringify(input)}; globalThis[${JSON.stringify(globalName)}] = behaviorApi();`
    : `import * as api from ${JSON.stringify(input)}; globalThis[${JSON.stringify(globalName)}] = api;`;
  await build({
    stdin: { contents, loader: "js", resolveDir: output },
    outfile: target,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    conditions: variant.conditions,
  });
  return target;
}

before(async () => {
  assert.equal(existsSync(compiler), true, `LilScript compiler not found at ${compiler}`);
  const installed = JSON.parse(
    await readFile(join(root, "node_modules/solid-js/package.json"), "utf8"),
  );
  assert.equal(installed.version, "2.0.0-rc.0");
  output = await mkdtemp(join(tmpdir(), "solidlil-client-behavior-"));

  for (const variant of variants) {
    variant.candidatePath = compileCandidate(variant);
    variant.referencePath = await buildReference(variant);
    const nonce = `${Date.now()}-${variant.name}`;
    variant.candidate = (await import(`${pathToFileURL(variant.candidatePath).href}?${nonce}`)).behaviorApi();
    variant.reference = await import(`${pathToFileURL(variant.referencePath).href}?${nonce}`);
    variant.candidateBrowser = await buildBrowserBundle(
      variant.candidatePath,
      `Candidate_${variant.name}`,
      true,
      variant,
    );
    variant.referenceBrowser = await buildBrowserBundle(
      variant.referencePath,
      `Reference_${variant.name}`,
      false,
      variant,
    );
  }

  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chromePath)
      ? { executablePath: chromePath, args: ["--headless=new"] }
      : {}),
  });
});

after(async () => {
  await browser?.close();
  if (output) await rm(output, { recursive: true, force: true });
});

function captureError(fn) {
  try {
    fn();
    return { thrown: false };
  } catch (error) {
    return {
      thrown: true,
      type: typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function componentSnapshot(api) {
  const result = {};
  result.clientIds = [api.createUniqueId(), api.createUniqueId()];
  const Context = api.createContext("default", { name: "behavior" });
  const Missing = api.createContext();
  result.contextDefaults = api.createRoot(() => [
    api.useContext(Context),
    captureError(() => api.useContext(Missing)),
  ]);

  let childReads = 0;
  result.provider = api.createRoot(() => {
    const parentOwner = api.getOwner();
    const provided = api.createComponent(Context, {
      value: "outer",
      get children() {
        childReads++;
        const providerOwner = api.getOwner();
        const inner = api.createComponent(Context, {
          value: "inner",
          get children() {
            return api.useContext(Context);
          },
        });
        return [
          api.useContext(Context),
          inner(),
          providerOwner !== parentOwner,
        ];
      },
    });
    const first = provided();
    const second = provided();
    return { first, cached: first === second, childReads };
  });

  const component = api.createRoot(() => {
    const [source, setSource] = api.createSignal(2);
    const props = { offset: 3 };
    let callerOwner;
    let componentOwner;
    let bodyRuns = 0;
    let memoRuns = 0;
    function Probe(received) {
      bodyRuns++;
      componentOwner = api.getOwner();
      return source() + received.offset;
    }
    const view = api.createMemo(() => {
      memoRuns++;
      callerOwner = api.getOwner();
      return api.createComponent(Probe, props);
    }, { sync: true });
    const nullProps = api.createComponent(value => Object.keys(value).length, null);
    return {
      view,
      setSource,
      propsIdentity: api.createComponent(value => value === props, props),
      nullProps,
      details: () => ({
        bodyRuns,
        memoRuns,
        sameOwner: componentOwner === callerOwner,
        componentMetadata: !!componentOwner?._component,
      }),
    };
  });
  const initial = component.view();
  component.setSource(8);
  api.flush();
  result.component = {
    initial,
    afterUntrackedWrite: component.view(),
    ...component.details(),
    propsIdentity: component.propsIdentity,
    nullProps: component.nullProps,
  };

  const dynamic = api.createRoot(() => {
    const [kind, setKind] = api.createSignal("a");
    const calls = [];
    const A = props => (calls.push(`a:${props.value}`), `A${props.value}`);
    const B = props => (calls.push(`b:${props.value}`), `B${props.value}`);
    const view = api.createMemo(() => {
      const current = kind();
      return api.createComponent(current === "a" ? A : B, { value: current.length });
    }, { sync: true });
    return { view, setKind, calls };
  });
  const dynamicValues = [dynamic.view()];
  dynamic.setKind("bb");
  api.flush();
  dynamicValues.push(dynamic.view());
  result.dynamic = { values: dynamicValues, calls: dynamic.calls };

  const childState = api.createRoot(() => {
    const [source, setSource] = api.createSignal([1, [() => 2, null], false]);
    let evaluations = 0;
    const resolved = api.children(() => {
      evaluations++;
      return source();
    });
    return { resolved, setSource, evaluations: () => evaluations };
  });
  const initialChildren = [childState.resolved(), childState.resolved.toArray(), childState.evaluations()];
  childState.setSource(["x", [() => ["y", "z"]]]);
  api.flush();
  const updatedChildren = [childState.resolved(), childState.resolved.toArray(), childState.evaluations()];
  childState.setSource(null);
  api.flush();
  const emptyChildren = [childState.resolved(), childState.resolved.toArray(), childState.evaluations()];
  result.children = { initial: initialChildren, updated: updatedChildren, empty: emptyChildren };
  return result;
}

function listSnapshot(api) {
  const state = api.createRoot(() => {
    let token = 0;
    const a = { id: "a", label: "A" };
    const b = { id: "b", label: "B" };
    const [items, setItems] = api.createSignal([a, b]);
    const keyed = api.For({
      get each() {
        return items();
      },
      fallback: "empty",
      children: (item, index) => ({ token: ++token, item, index }),
    });
    let customToken = 0;
    const [customItems, setCustomItems] = api.createSignal([
      { id: 1, label: "one" },
      { id: 2, label: "two" },
    ]);
    const custom = api.For({
      get each() {
        return customItems();
      },
      keyed: item => item.id,
      children: (item, index) => ({ token: ++customToken, item, index }),
    });
    let indexedToken = 0;
    const [indexedItems, setIndexedItems] = api.createSignal(["a", "b"]);
    const indexed = api.For({
      get each() {
        return indexedItems();
      },
      keyed: false,
      children: (item, index) => ({ token: ++indexedToken, item, index }),
    });
    let repeatToken = 0;
    const [count, setCount] = api.createSignal(3);
    const [from, setFrom] = api.createSignal(2);
    const repeated = api.Repeat({
      get count() {
        return count();
      },
      get from() {
        return from();
      },
      fallback: "none",
      children: index => ({ token: ++repeatToken, index }),
    });
    return {
      keyed,
      setItems,
      custom,
      setCustomItems,
      indexed,
      setIndexedItems,
      repeated,
      setFrom,
      setCount,
      calls: () => ({ token, customToken, indexedToken, repeatToken }),
    };
  });
  const keyedInitial = state.keyed().map(row => [row.token, row.item.id, row.index()]);
  state.setItems([
    state.keyed()[1].item,
    state.keyed()[0].item,
    { id: "c", label: "C" },
  ]);
  api.flush();
  const keyedUpdated = state.keyed().map(row => [row.token, row.item.id, row.index()]);
  state.setItems([]);
  api.flush();
  const keyedEmpty = state.keyed();

  const customInitial = state.custom().map(row => [row.token, row.item().label, row.index()]);
  state.setCustomItems([
    { id: 2, label: "TWO" },
    { id: 1, label: "ONE" },
  ]);
  api.flush();
  const customUpdated = state.custom().map(row => [row.token, row.item().label, row.index()]);

  const indexedInitial = state.indexed().map(row => [row.token, row.item(), row.index]);
  state.setIndexedItems(["A", "B", "C"]);
  api.flush();
  const indexedUpdated = state.indexed().map(row => [row.token, row.item(), row.index]);

  const repeatInitial = state.repeated().map(row => [row.token, row.index]);
  state.setFrom(3);
  state.setCount(2);
  api.flush();
  const repeatShifted = state.repeated().map(row => [row.token, row.index]);
  state.setCount(0);
  api.flush();
  const calls = state.calls();
  return {
    keyed: { keyedInitial, keyedUpdated, keyedEmpty, calls: calls.token },
    custom: { customInitial, customUpdated, calls: calls.customToken },
    indexed: { indexedInitial, indexedUpdated, calls: calls.indexedToken },
    repeat: { repeatInitial, repeatShifted, empty: state.repeated(), calls: calls.repeatToken },
  };
}

function conditionalSnapshot(api) {
  const state = api.createRoot(() => {
    const [when, setWhen] = api.createSignal({ label: "one" });
    let showAccessor;
    let showCalls = 0;
    const shown = api.Show({
      get when() {
        return when();
      },
      fallback: "hidden",
      children: value => {
        showAccessor = value;
        return { token: ++showCalls };
      },
    });
    const [keyedWhen, setKeyedWhen] = api.createSignal({ label: "a" });
    let keyedCalls = 0;
    const keyedShow = api.Show({
      get when() {
        return keyedWhen();
      },
      keyed: true,
      children: value => ({ token: ++keyedCalls, label: value.label }),
    });
    const childFunction = () => "not eagerly called";
    const zeroArgumentShow = api.Show({ when: true, children: childFunction });

    const [first, setFirst] = api.createSignal(false);
    const [second, setSecond] = api.createSignal({ label: "second" });
    const branchCalls = { first: 0, second: 0 };
    let firstAccessor;
    let secondAccessor;
    const firstMatch = api.Match({
      get when() {
        return first();
      },
      children: value => {
        firstAccessor = value;
        return { branch: "first", token: ++branchCalls.first };
      },
    });
    const secondMatch = api.Match({
      get when() {
        return second();
      },
      children: value => {
        secondAccessor = value;
        return { branch: "second", token: ++branchCalls.second };
      },
    });
    const switched = api.Switch({
      fallback: "no-match",
      children: [null, firstMatch, secondMatch],
    });
    return {
      shown,
      setWhen,
      showAccessor: () => showAccessor,
      showCalls: () => showCalls,
      keyedShow,
      setKeyedWhen,
      keyedCalls: () => keyedCalls,
      childFunction,
      zeroArgumentShow,
      firstMatch,
      switched,
      setFirst,
      setSecond,
      firstAccessor: () => firstAccessor,
      secondAccessor: () => secondAccessor,
      branchCalls,
    };
  });
  const result = {};
  const firstShow = state.shown();
  state.setWhen({ label: "two" });
  api.flush();
  result.showTruthy = {
    sameChild: state.shown() === firstShow,
    value: state.showAccessor()().label,
    calls: state.showCalls(),
  };
  state.setWhen(false);
  api.flush();
  result.showFalse = [state.shown(), captureError(() => state.showAccessor()())];
  state.setWhen({ label: "three" });
  api.flush();
  result.showRemount = [state.shown().token, state.showAccessor()().label, state.showCalls()];

  const keyedValues = [state.keyedShow()];
  state.setKeyedWhen({ label: "b" });
  api.flush();
  keyedValues.push(state.keyedShow());
  result.keyedShow = { values: keyedValues, calls: state.keyedCalls() };
  result.zeroArgumentChild = state.zeroArgumentShow() === state.childFunction;
  result.matchIdentity = state.firstMatch.when === false;

  const switchInitial = state.switched();
  state.setFirst({ label: "first" });
  api.flush();
  const switchFirst = state.switched();
  const staleSecond = captureError(() => state.secondAccessor()());
  state.setFirst({ label: "FIRST" });
  api.flush();
  const switchUpdated = [state.switched() === switchFirst, state.firstAccessor()().label];
  state.setFirst(false);
  state.setSecond(false);
  api.flush();
  result.switch = {
    initial: switchInitial,
    selected: switchFirst,
    staleSecond,
    updated: switchUpdated,
    fallback: state.switched(),
    branchCalls: state.branchCalls,
  };
  return result;
}

function errorSnapshot(api) {
  const state = api.createRoot(() => {
    const [fail, setFail] = api.createSignal(false);
    let fallbacks = 0;
    const boundary = api.Errored({
      get children() {
        if (fail()) throw new Error("boom");
        return "healthy";
      },
      fallback: (error, reset) => {
        fallbacks++;
        return `${error().message}:${typeof reset}`;
      },
    });
    return { boundary, setFail, fallbacks: () => fallbacks };
  });
  const values = [state.boundary()];
  state.setFail(true);
  api.flush();
  values.push(state.boundary());
  state.setFail(false);
  api.flush();
  values.push(state.boundary());
  return { values, fallbacks: state.fallbacks() };
}

async function settle(api) {
  await Promise.resolve();
  await Promise.resolve();
  api.flush();
  await Promise.resolve();
  api.flush();
}

async function asyncSnapshot(api) {
  const result = {};
  let resolveLoading;
  const loadingTask = new Promise(resolvePromise => {
    resolveLoading = resolvePromise;
  });
  const loading = api.createRoot(() => {
    const pending = api.createMemo(() => loadingTask);
    return api.Loading({
      get children() {
        return pending();
      },
      fallback: "waiting",
    });
  });
  result.loading = [loading()];
  resolveLoading("ready");
  await loadingTask;
  await settle(api);
  result.loading.push(loading());

  let resolveLazy;
  let loads = 0;
  const lazyTask = new Promise(resolvePromise => {
    resolveLazy = resolvePromise;
  });
  const Lazy = api.lazy(() => {
    loads++;
    return lazyTask;
  }, "./lazy-unit.js");
  const first = api.createRoot(dispose => ({ dispose, view: Lazy({ name: "first" }) }));
  const second = api.createRoot(dispose => ({ dispose, view: Lazy({ name: "second" }) }));
  const preload = Lazy.preload();
  const pendingReads = [captureError(first.view), captureError(second.view)];
  first.dispose();
  resolveLazy({ default: props => `loaded:${props.name}` });
  await lazyTask;
  await settle(api);
  result.lazy = {
    moduleUrl: Lazy.moduleUrl,
    oneLoader: loads,
    preloadIdentity: preload === lazyTask,
    pendingReads,
    survivingInstance: second.view(),
  };
  second.dispose();

  let resolveFirst;
  let resolveSecond;
  const firstTask = new Promise(resolvePromise => {
    resolveFirst = resolvePromise;
  });
  const secondTask = new Promise(resolvePromise => {
    resolveSecond = resolvePromise;
  });
  const reveal = api.createRoot(() => {
    const firstValue = api.createMemo(() => firstTask);
    const secondValue = api.createMemo(() => secondTask);
    return api.Reveal({
      order: "sequential",
      collapsed: false,
      get children() {
        return [
          api.Loading({
            get children() {
              return firstValue();
            },
            fallback: "first-waiting",
          }),
          api.Loading({
            get children() {
              return secondValue();
            },
            fallback: "second-waiting",
          }),
        ];
      },
    });
  });
  const readReveal = () => reveal.map(slot => slot());
  const revealValues = [readReveal()];
  resolveSecond("second-ready");
  await secondTask;
  await settle(api);
  revealValues.push(readReveal());
  resolveFirst("first-ready");
  await firstTask;
  await settle(api);
  revealValues.push(readReveal());
  result.reveal = revealValues;
  return result;
}

async function hydrationSnapshot(bundlePath, globalName) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  try {
    await page.setContent('<!doctype html><body><div id="frag"><span id="pl-frag"></span></div></body>');
    await page.evaluate(() => {
      globalThis.__fragmentEvents = [];
      globalThis.$dfr = id => `defer:${id}`;
      globalThis._$HY = {
        r: { frag_fr: { s: 0 } },
        fe(id) {
          globalThis.__fragmentEvents.push(`base:${id}`);
        },
      };
    });
    await page.addScriptTag({ path: bundlePath });
    const snapshot = await page.evaluate(async globalName => {
      const api = globalThis[globalName];
      const config = api.sharedConfig;
      const registry = new Map([["kept-until-end", {}]]);
      config.registry = registry;
      api.enableHydration();

      const descriptor = Object.getOwnPropertyDescriptor(config, "hydrating");
      let noHydrateContext;
      config.hydrating = false;
      const visible = api.createRoot(() => api.NoHydration({
        get children() {
          noHydrateContext = api.useContext(api.NoHydrateContext);
          return "visible";
        },
      }));

      let hiddenReads = 0;
      config.hydrating = true;
      const hidden = api.createRoot(() => api.NoHydration({
        get children() {
          hiddenReads++;
          return "hidden";
        },
      }));
      let hydrationReads = 0;
      const passthrough = api.Hydration({
        get children() {
          hydrationReads++;
          return "hydrated-child";
        },
      });
      const ids = api.createRoot(
        () => [api.createUniqueId(), api.createUniqueId()],
        { id: "ids" },
      );

      const loads = [];
      let loadKind = "value";
      config.has = () => true;
      config.load = id => {
        loads.push(id);
        if (loadKind === "error") return new Error(`serialized:${id}`);
        return { s: 1, v: `serialized:${id}` };
      };
      let memoComputes = 0;
      const hydratedMemo = api.createRoot(() => api.createMemo(() => {
        memoComputes++;
        return "client";
      }, { sync: true }), { id: "memo" });
      const memoValue = hydratedMemo();

      let signalComputes = 0;
      const hydratedSignal = api.createRoot(() => api.createSignal(() => {
        signalComputes++;
        return "client-signal";
      }), { id: "signal" });
      const signalValue = hydratedSignal[0]();

      loadKind = "error";
      const hydratedError = api.createRoot(() => api.createErrorBoundary(
        () => "client-content",
        error => error().message,
      ), { id: "error" });
      const errorValue = hydratedError();

      const fragmentEvents = [];
      const unsubscribe = globalThis._$HY.fr.subscribe(id => fragmentEvents.push(`sub:${id}`));
      globalThis._$HY.fe("frag", document.body);
      unsubscribe();
      globalThis._$HY.fe("after", document.body);
      const fragmentPending = globalThis._$HY.fr.pending();
      globalThis._$HY.fr.claim("frag");
      globalThis._$HY.fr.release("frag");

      const hydrationPhases = [];
      config.onHydrationEnd(() => hydrationPhases.push("ended"));
      hydrationPhases.push(config.isHydrationInProgress());
      config.hydrating = false;
      hydrationPhases.push(config.isHydrationInProgress(), config.done);
      await Promise.resolve();
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100));

      return {
        hooks: {
          descriptor: [!!descriptor?.get, !!descriptor?.set, descriptor?.enumerable],
          onHydrationEnd: typeof config.onHydrationEnd,
          fragmentApi: Object.keys(globalThis._$HY.fr).sort(),
        },
        wrappers: {
          visible,
          noHydrateContext,
          hidden: hidden === undefined ? "undefined" : hidden,
          hiddenReads,
          passthrough,
          hydrationReads,
        },
        ids,
        serialized: {
          memoValue,
          memoComputes,
          signalValue,
          signalComputes,
          errorValue,
          loads,
        },
        fragmentPending,
        fragmentEvents,
        baseFragmentEvents: globalThis.__fragmentEvents,
        hydrationPhases,
        hydrationDone: globalThis._$HY.done,
        registrySize: registry.size,
      };
    }, globalName);
    return { snapshot, pageErrors };
  } finally {
    await page.close();
  }
}

test("the behavior entry compiles with the required development and production configurations", () => {
  for (const variant of variants) assert.equal(existsSync(variant.candidatePath), true, variant.name);
});

for (const variant of variants) {
  test(`${variant.name}: components, contexts, children, and owners match solid-js`, () => {
    assert.deepEqual(componentSnapshot(variant.candidate), componentSnapshot(variant.reference));
  });

  test(`${variant.name}: For and Repeat preserve mapping identity and fallback behavior`, () => {
    assert.deepEqual(listSnapshot(variant.candidate), listSnapshot(variant.reference));
  });

  test(`${variant.name}: Show, Switch, and Match preserve narrowing behavior`, () => {
    assert.deepEqual(conditionalSnapshot(variant.candidate), conditionalSnapshot(variant.reference));
  });

  test(`${variant.name}: Errored catches and recovers from reactive failures`, () => {
    assert.deepEqual(errorSnapshot(variant.candidate), errorSnapshot(variant.reference));
  });

  test(`${variant.name}: Loading, Reveal, and lazy match async behavior`, async () => {
    assert.deepEqual(await asyncSnapshot(variant.candidate), await asyncSnapshot(variant.reference));
  });

  test(`${variant.name}: hydration wrappers and unique IDs match in a browser`, async () => {
    const actual = await hydrationSnapshot(
      variant.candidateBrowser,
      `Candidate_${variant.name}`,
    );
    const expected = await hydrationSnapshot(
      variant.referenceBrowser,
      `Reference_${variant.name}`,
    );
    assert.deepEqual(actual, expected);
  });
}
