# @itslil/solidjs

Experimental Solid 2.0 runtime work in LilScript. This package is not yet an
exact or drop-in Solid implementation.

Status: [yeargun.github.io/solidlil](https://yeargun.github.io/solidlil/)

## Exact-port status

The target is pinned locally and by commit in `upstream.lock.json`:

- `solidjs/solid` `v2.0.0-rc.0`: `ff4d3c4479163fbdd3327f5b22d0c3ea7bd1a2c5`
- `dom-expressions`: `8e4403036b3e476dba0406b0798f98740e226dc4`
- 47 browser-runtime source modules must have matching typed `.lil` files.
- Every matching module must pass upstream differential behavior tests.

Run `npm run setup:upstream` to clone both pinned repositories locally. Run
`npm run audit:upstream` to refresh `site/upstream-port.json`, or
`npm run audit:upstream:strict` to fail unless the port is complete. The current
compatibility prototype under `src/` does not satisfy this gate.

The complete design and release criteria are in
[`docs/exact-port-contract.md`](docs/exact-port-contract.md).

## Why the old comparison was withdrawn

The earlier package matched many export names and selected tests, but it
collapsed Solid's scheduler, graph, stores, hydration, DOM runtime, and server
behavior into a much smaller custom implementation plus JavaScript facades.
That made its size useful as an experiment, but not as evidence for an exact
Solid port or for LilScript compression alone.

The locally measured upstream `solid-js/dist/solid.js` is 8,353 B gzip-9 and
7,505 B Brotli-11. The prototype `dist/core.js` is 3,326 B gzip-9 and 2,979 B
Brotli-11. A difference that large is expected while substantial semantics are
missing, so no winner is claimed.

## Diagnostic keyed build

The tracked keyed pair now controls the source-level workload and final tools:

- object-identity keyed rows;
- matching random-data, selection, replacement, and removal logic;
- matching visible output;
- ES2022 modules;
- Terser 5.43.1 with three passes and top-level mangling;
- the same canonical gzip-9 and Brotli-11 scorer.

Tree shaking remains enabled in both production lanes. Solid uses Vite module
tree shaking; SolidLil uses LilScript whole-program DCE. The generated evidence
also contains native-toolchain, shared property-mangling, and Solid-without-Vite-
tree-shaking diagnostics.

The current non-qualifying snapshot is 11,255 B versus 3,414 B Brotli. Turning
off Vite tree shaking on the Solid side produces 12,705 B, so that Vite step
accounts for 1,450 B. The remaining difference still combines runtime design
with LilScript's DCE and representation choices. It is not published as an
exact-runtime comparison.

CPU and memory results are withheld until they are rerun against the exact
current bundle hashes.

## Development

Keep this checkout next to the LilScript checkout, or set
`SOLIDLIL_LILSCRIPT_BIN` and `SOLIDLIL_CODEC` explicitly.

```sh
npm ci
npm run build
npm run build:apps
npm run build:jfb
npm run measure:jfb
npm run audit:upstream
npm run check
```

The current prototype remains installable for development:

```sh
npm install @itslil/solidjs
```

Do not treat it as an exact Solid replacement until
`npm run audit:upstream:strict` and the mirrored upstream behavior suites pass.

The implementation is MIT licensed. See [NOTICE.md](./NOTICE.md) for upstream
attribution.
