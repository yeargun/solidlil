# @itslil/solidjs

Solid 2.0’s client runtime, compiled with LilScript and published as `@itslil/solidjs`. Source: [github.com/yeargun/lil-solidjs](https://github.com/yeargun/lil-solidjs).

**Source-aligned [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) keyed app: 69.7% smaller Brotli (11,255 B → 3,414 B)** with the same final Terser settings on both artifacts. Tree shaking remains enabled in both production lanes. The **[solidlil demo lab](https://yeargun.github.io/solidlil/)** also publishes native-toolchain, shared property-mangling, and Solid-without-tree-shaking diagnostics. CPU and memory are withheld until rerun against these exact artifact hashes.

| Reproducible result | Solid 2.0 | `@itslil/solidjs` | Ratio | Reduction |
| --- | ---: | ---: | ---: | ---: |
| [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) keyed app, same Terser, Brotli-11 | 11,255 B | 3,414 B | 0.303× | **69.7%** |
| Same artifact, gzip-9 | 12,319 B | 3,789 B | 0.308× | **69.2%** |
| Same artifact, raw JS | 32,401 B | 9,305 B | 0.287× | **71.3%** |
| Native production output, Brotli-11 | 11,182 B | 3,515 B | 0.314× | **68.6%** |

The canonical size row keeps source-level work and final minification aligned: object-identity keyed rows, matching selection/reset/removal logic and text, ES2022 modules, then Terser 5.43.1 with three passes and top-level mangling. The frontends retain their production strengths: Vite tree-shakes Solid and LilScript performs whole-program DCE. This is therefore a complete application-toolchain result, not proof that the compressor alone accounts for every byte.

The tree-shaking ablation builds the same Solid entry with Vite tree shaking disabled, then applies the canonical Terser pass. Solid changes from **11,255 B to 12,705 B Brotli**. Vite's tree-shaking step therefore accounts for 1,450 B. The remaining 7,841 B gap still combines LilScript's stronger whole-program DCE with runtime representation; this app comparison cannot separate those two effects. The retained-module ledger shows that the shaken Solid app still reaches scheduler, async, map, boundaries, and Web runtime code.

```sh
npm install @itslil/solidjs
```

```js
import { createSignal, createMemo, createEffect, flush, createRoot } from "@itslil/solidjs"

createRoot(() => {
  const [count, setCount] = createSignal(0)
  const doubled = createMemo(() => count() * 2)

  createEffect(
    () => doubled(),
    (value) => console.log(value),
  )

  setCount(1)
  flush()
})
```

## Compatibility

`@itslil/solidjs` is the Solid 2.0 **client** (`solid-js@2.0.0-rc.0`, `@solidjs/web@2.0.0-rc.0`): every public export, including `flush`, split `createEffect`, `For` / `Repeat` / `Show` / `Switch` / `Reveal`, `Loading` / `Errored`, stores, `createProjection` / `reconcile`, `action` / `createOptimistic`, `hydrate` (claims existing DOM), `renderToString` / `renderToStream`, `lazy`, `children`, and the rest of the 2.0 authoring surface. LSX `hydrate()` / `<Reveal>` compile to the same Lil primitives. Solid 2.0 dropped `batch`, `createResource`, and `startTransition`; we match that. The tracked keyed pair calls `render()` on both sides.

LilScript apps are written in **LSX** (`.lilx`) — JSX for LilScript — and compile closed-world (`import … from "solidlil"`). JavaScript consumers use the tuple helpers on the default entry. A DOM app should import only from `@itslil/solidjs/web` so it shares one reactive graph; mixing `@itslil/solidjs` with `@itslil/solidjs/web` duplicates the runtime.

```lil
import { Signal, append, createIntSignal, render } from "solidlil";

func()->void dispose = render("#app", (Element root) => {
  Signal<int> count = createIntSignal(0);
  Element view = (
    <button type="button" onClick={() => { count.write(count.read() + 1); }}>
      {`Count ${count.read()}`}
    </button>
  );
  append(root, view);
});
```

```js
import { render, bindText, keyedEach, createIntSignal } from "@itslil/solidjs/web"
```

## Why smaller

The keyed result is not produced by property-mangling SolidLil harder. The canonical row disables Terser property mangling on both sides. Applying the same `/^_/` property rule changes Solid from 11,255 B to 11,222 B Brotli and SolidLil from 3,414 B to 3,409 B, so that lever does not explain the gap.

**Owned fields become slots.** Solid’s graph is objects — [core.ts](https://github.com/solidjs/solid/blob/v2.0.0-rc.0/packages/solid-signals/src/core/core.ts), [owner.ts](https://github.com/solidjs/solid/blob/v2.0.0-rc.0/packages/solid-signals/src/core/owner.ts) — so a signal still has many named fields (`e.se`, `e.Ne`) after `^_` mangling. LilScript structs in [reactive.lil](https://github.com/yeargun/lil-solidjs/blob/main/src/reactive.lil) lower to `e[0]`, `e[1]` under [lilscript.closed.toml](https://github.com/yeargun/lil-solidjs/blob/main/src/lilscript.closed.toml) (`public_aggregate_abi = "positional"`). `extern class` DOM names stay. Terser cannot prove ownership.

**Same templates, thinner For.** Both jumbotrons compile to `cloneNode` HTML. Solid JSX uses [`template().cloneNode`](https://github.com/solidjs/solid/blob/v2.0.0-rc.0/packages/solid-web/src/index.ts) and [`For`](https://github.com/solidjs/solid/blob/v2.0.0-rc.0/packages/solid/src/client/flow.ts). LSX does the same in [lilx/lower.mjs](https://github.com/yeargun/lil-solidjs/blob/main/tooling/lilx/lower.mjs) → [web.lil](https://github.com/yeargun/lil-solidjs/blob/main/src/web.lil) `keyedEach` / [lsx.lil](https://github.com/yeargun/lil-solidjs/blob/main/src/lsx.lil). Compare [JFB Solid JSX](https://github.com/yeargun/lil-solidjs/blob/main/benchmarks/js-framework-benchmark/keyed/solid-v2/src/main.jsx) with [JFB LSX](https://github.com/yeargun/lil-solidjs/blob/main/benchmarks/js-framework-benchmark/keyed/solidlil/src/main.lilx).

**Same flush, same pending.** The port is the 2.0 authoring surface: microtask `flush`, split effects, `For` / `Reveal` / `Loading`, stores, `createProjection`, `action` / `createOptimistic`, `isPending` / `latest`, `hydrate`. Solid’s [scheduler.ts](https://github.com/solidjs/solid/blob/v2.0.0-rc.0/packages/solid-signals/src/core/scheduler.ts) is the flush; ours is `pendingWrites` and `flush()` in [reactive.lil](https://github.com/yeargun/lil-solidjs/blob/main/src/reactive.lil). Solid’s [async.ts](https://github.com/solidjs/solid/blob/v2.0.0-rc.0/packages/solid-signals/src/core/async.ts) is NotReady plus pending; ours is the same verbs in [web.lil](https://github.com/yeargun/lil-solidjs/blob/main/src/web.lil). The tracked pair calls `render()` on both sides.

**Tree-shaking remains on and is measured.** Solid uses Vite module tree shaking; LilScript uses whole-program DCE. The no-tree-shaking Solid diagnostic quantifies that lever instead of removing it. `export *` and summed demo totals remain excluded because they describe different deployment boundaries.

**Tooling.** [LilScript](https://github.com/yeargun/lilscript) types the program and searches JS against Brotli ([show-hn](https://github.com/yeargun/lilscript/blob/main/docs/show-hn.md), [mangle / ABI](https://github.com/yeargun/lilscript/blob/main/docs/configuration.md)). **LSX** (`.lilx`) is JSX for that language: [parse-jsx.mjs](https://github.com/yeargun/lil-solidjs/blob/main/tooling/lilx/parse-jsx.mjs) then `lower.mjs`. The [lab](https://yeargun.github.io/solidlil/) leads with the source-aligned keyed pair. The paired iframes are closed-world extras. `npm install @itslil/solidjs` is the reusable ESM vendor chunk, not those demos summed.

## What “smaller” means

A normal client app vendors the framework once, then adds modules. In the source-aligned keyed pair, Solid 2.0 is **32,401 B raw / 11,255 B Brotli-11** and `@itslil/solidjs` LSX is **9,305 B raw / 3,414 B Brotli-11** after the shared final Terser pass.

The lab demos are closed-world LSX builds of the same UI. They are not how a typical Solid or React app is shipped. Use the js-framework-benchmark keyed row.

CPU is not inferred from size. Current CPU and memory stay unpublished until the runner is rerun against the exact canonical bundle hashes.

The reusable package ESM is a different artifact from those app builds. `npm run test:size` prints package and named-import sizes.

## Build pipeline

Keep `solidlil` next to a LilScript checkout, or point at a release compiler:

```sh
npm ci
SOLIDLIL_LILSCRIPT_BIN=/path/to/lilscript npm run build
npm run build:apps
npm run build:jfb
npm run measure:jfb
npm run check
```

Set `SOLIDLIL_BUILD_MODE=development` for a faster local library build. Production is the default. `SOLIDLIL_SKIP_BROWSER=1` skips Playwright if Chromium is not installed.

## Verification

```sh
npm test           # Node reactivity + Vite consumer bundle
npm run check      # tests, TypeScript declarations, Pages artifact, npm tarball
npm run test:size  # package raw/gzip/brotli report
npm run build:site # GitHub Pages lab
```

The implementation is MIT licensed. See [NOTICE.md](./NOTICE.md) for upstream attribution.
