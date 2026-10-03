# @itslil/solidjs

An experimental Solid 2.0 compatibility runtime implemented in LilScript with JavaScript providers. This is not an exact or drop-in Solid implementation.

[Live comparison and examples](https://yeargun.github.io/solidlil/) · [Checked repository package](https://yeargun.github.io/solidlil/downloads/package.tgz) · [Package build evidence](https://yeargun.github.io/solidlil/package-build.json)

```sh
npm install @itslil/solidjs
```

```js
import {createRoot, createSignal, flush} from "@itslil/solidjs"
createRoot(() => {
  const [value, setValue] = createSignal(0)
  setValue(1)
  flush()
  console.log(value())
})
```

The repository download contains the checked build of this checkout. npm publication is independent; an npm install can resolve a different published snapshot.

## Comparison with the original

[Current raw, gzip and Brotli results and build times](COMPARISON.md) compare three independently targeted LilScript compilations with the smallest recorded original result for each codec from Terser, esbuild and Oxc. Exact bytes, configuration hashes, source inputs and commands are downloadable from the comparison page. Package formats and browser application bundles have different boundaries from the standalone comparison entries.

## Compatibility and scope

The target is solid-js 2.0.0-rc.0. Scheduler, stores, hydration, DOM and server behavior are not fully equivalent. The size comparison includes the current compatibility implementation and its embedded JavaScript providers; it is not proof of equivalent features or compiler-only savings. The 21 paired browser fixtures check selected user interactions. The exact-port criteria remain in docs/exact-port-contract.md and the audit:upstream:strict gate.

## Rebuild and verify

Set `LILSCRIPT_COMPILER` to the current LilScript executable. Builds use one compiler job at a time.

```sh
npm ci
npm run build
npm test
npm run check:site
```

Run `npm run build:apps` to rebuild the paired browser fixtures, then `node --test test/apps-e2e.test.mjs`. The exact-port gate is `npm run audit:upstream:strict`; it is not currently satisfied.

See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for licensing and upstream attribution.
