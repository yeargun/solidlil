# Exact Solid port contract

## Goal

Measure what LilScript can do to a faithful Solid 2.0 implementation. The port
must preserve Solid's observable behavior and important algorithmic structure;
the compiler may then change representation, naming, layout, and dead code.

Identical generated JavaScript is not required. If both outputs had to be
identical, the benchmark would measure only syntax translation and would forbid
the optimizations this project exists to test.

## Pinned upstream

`upstream.lock.json` is authoritative:

- Solid `v2.0.0-rc.0` at `ff4d3c4479163fbdd3327f5b22d0c3ea7bd1a2c5`
- DOM Expressions at `8e4403036b3e476dba0406b0798f98740e226dc4`

`npm run setup:upstream` creates local detached checkouts under `upstream/`.
All audits and ports use those files, never fetched HTML or an unpinned branch.

## Source layout

The browser runtime consists of 47 authored runtime modules:

- 30 under `packages/solid-signals/src`
- 5 under `packages/solid/src`
- 5 under `packages/solid-web/src`
- 7 under `packages/runtime/src` in DOM Expressions

Each source module maps to one typed `.lil` module under `src/upstream/`, with
the same repository-relative basename and directory structure. JavaScript
facades, forwarding files, and same-named stubs do not count as ports.

Some upstream modules form import cycles. LilScript must support their static
live-binding semantics, or the port must use an explicit shared kernel while
retaining one source-aligned facade per upstream module. Such a deviation must
be recorded in `upstream.lock.json` and tested; silently flattening the graph is
not acceptable.

## What must match

The following are compatibility requirements, not optimization suggestions:

1. Public package entrypoints, conditional exports, export names, value kinds,
   function arity, and TypeScript declarations.
2. Reactive graph ordering, equality, ownership, cleanup, errors, scheduling,
   async settlement, transitions, optimistic lanes, and snapshot behavior.
3. Store proxy identity, property-level tracking, descriptors, symbols, array
   behavior, reconciliation, projections, and optimistic writes.
4. DOM node count and identity, insertion ranges, text reuse, attributes,
   properties, styles, namespaces, delegated events, portals, and cleanup.
5. Hydration IDs, node claiming, multi-root isolation, streamed boundaries,
   event replay, mismatch handling, and snapshot adoption.
6. Browser and server entry behavior, SSR node shapes, streaming, responses,
   cookies, assets, and head management for every declared supported entry.

Where JavaScript object identity, prototypes, descriptors, symbols, exceptions,
or host objects are observable, the LilScript source must express that behavior
explicitly. Typed positional layouts are allowed only for values proved private
to the implementation.

## Verification stages

A module advances through these states:

1. `missing`: no matching `.lil` source exists.
2. `translated`: the matching typed source exists and compiles in oracle mode.
3. `behavior-verified`: corresponding upstream tests pass against both builds.
4. `shape-verified`: required JavaScript-sensitive invariants are checked, such
   as object identity, descriptors, scheduling order, and DOM node identity.
5. `verified`: all applicable gates pass and the module may contribute to a
   published comparison.

The exact-port gate passes only when all 47 modules are `verified`, all package
entrypoint tests pass, and no runtime behavior is supplied by JavaScript facade
code. Host declarations are allowed; host implementations are not.

## Build modes

The same `.lil` source is compiled in two modes:

- **Oracle mode:** conservative named layouts and minimal transformations. Its
  purpose is differential debugging and recognizable JavaScript structure.
- **Optimized mode:** production LilScript DCE, specialization, positional
  private layouts, mangling, and codec-guided search.

The oracle build establishes that the language can express the upstream logic.
The optimized build measures what the compiler can safely remove or reshape.

## Published measurements

After the exact-port gate passes, publish separate results for:

1. **Reusable browser runtime:** matching public exports retained, same target,
   same final minifier, same codec.
2. **Tree-shaken application:** matching application behavior, normal DCE in
   both toolchains, same final minifier and codec.
3. **Shared multi-entry delivery:** one shared runtime chunk plus route chunks;
   count every unique transferred artifact once, never once per demo.
4. **Native toolchains:** Solid's normal Vite/Oxc build and LilScript's normal
   production build, clearly labeled as a deployment comparison.
5. **Ablations:** no tree shaking, shared property mangling, and optimizer-off
   rows remain diagnostics and never replace the canonical rows.

CPU, memory, and cold-load results are valid only when their artifact hashes
match the size evidence. Missing phases remain unavailable rather than carrying
forward measurements from older bundles.

## Publication rule

No wording such as "exact", "drop-in", "parity", or a Solid-versus-SolidLil
winner is published until the strict source and behavior gates pass. Partial
results may be retained as diagnostics if they are explicitly marked
non-qualifying.
