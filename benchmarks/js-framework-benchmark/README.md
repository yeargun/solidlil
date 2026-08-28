# Solid 2.0 keyed comparison

This directory contains the two tracked implementations used by the SolidLil
size comparison. It measures an application boundary, not an isolated compiler
pass or reusable-library boundary.

The pair keeps these controls aligned:

- the same keyed-table behavior and visible text;
- object-identity row reconciliation;
- the same selection, replacement, removal, and random-data algorithms;
- ES2022 module output;
- Terser 5.43.1 with three compression passes and top-level mangling;
- the repository `lilscript-codec` implementation for gzip-9 and Brotli-11.

Tree shaking remains enabled in both canonical builds. Solid uses Vite's module
tree shaking, while SolidLil uses LilScript's whole-program DCE. The generated
evidence also records native-toolchain output, a shared private-property-mangle
lane, and a Solid build with Vite tree shaking disabled. These diagnostics show
where a difference comes from without weakening either production build.

From the repository root:

```sh
npm ci
npm ci --prefix benchmarks/js-framework-benchmark/keyed/solid-v2
npm ci --prefix benchmarks/js-framework-benchmark/keyed/solidlil
npm run build
npm run build:jfb
npm run measure:jfb
npm test
```

Set `SOLIDLIL_LILSCRIPT_BIN` and `SOLIDLIL_CODEC` to use binaries outside the
adjacent `../lilscript` checkout. CPU and memory results may be published only
when their measured bundle hashes match the current size artifacts.
