# Exact Solid 2 Browser Runtime Port

Updated: 2026-08-29

## Objective

Port the pinned Solid 2 browser runtime to typed LilScript with exact observable
behavior while allowing LilScript to optimize internal representation. Do not
publish size or speed rankings until the exact-runtime gate passes.

The strict gate is:

1. All 47 pinned browser-runtime source modules have source-aligned `.lil` files.
2. Every applicable upstream runtime test passes against the compiled LilScript
   implementation without delegating runtime logic to npm Solid packages.
3. Development and production builds preserve the public export and function
   arity contract.
4. DOM node identity, ranges, cleanup, events, hydration, stores, scheduling,
   errors, loading, optimistic transitions, and package exports match.
5. The 21 paired browser demos remain green after package entries switch to the
   source-aligned runtime.

## Pinned Sources

- Repository: `upstream/solid`
- Revision: `ff4d3c4479163fbdd3327f5b22d0c3ea7bd1a2c5`
- Tag: `v2.0.0-rc.0`
- Repository: `upstream/dom-expressions`
- Revision: `8e4403036b3e476dba0406b0798f98740e226dc4`
- Inventory: `upstream.lock.json`
- Semantic contract: `docs/exact-port-contract.md`

## Current Progress

### Source Inventory

- 47/47 expected source-aligned `.lil` files exist.
- 0 modules are missing.
- 0/47 modules are verified because the full applicable upstream corpus is not
  green yet.
- `site/upstream-port.json` currently reports `0 verified / 47 unverified / 0 missing`.
- No source-aligned implementation imports npm Solid runtime logic.

Run the audit:

```sh
npm run audit:upstream
npm run audit:upstream:strict
```

The strict command must continue failing until every required file is genuinely
verified. Do not populate `upstream.lock.json#verifiedFiles` merely because a
file exists or compiles.

### Signals Corpus

Latest full pinned corpus run:

```text
Assertions: 1069 passed, 143 failed, 30 skipped, 1242 total
Files:        60 passed,  21 failed,  5 skipped,   86 total
```

Command:

```sh
node scripts/upstream-signals-corpus.mjs
```

Latest failing assertions by file:

| File | Failures |
| --- | ---: |
| `createMemo.test.ts` | 12 |
| `diagnostics.test.ts` | 1 |
| `affects-propagation.test.ts` | 2 |
| `autodispose-contract.test.ts` | 1 |
| `autodispose-pending-release.test.ts` | 2 |
| `createLoadingBoundary.on.test.ts` | 5 |
| `createLoadingBoundary.test.ts` | 6 |
| `createOptimistic.test.ts` | 48 |
| `createRevealOrder.test.ts` | 3 |
| `latest-isPending-consistency.test.ts` | 2 |
| `loading-value.test.ts` | 17 |
| `question-scoped-pending.test.ts` | 21 |
| `resolve-in-action.test.ts` | 1 |
| `spec-async-semantics.test.ts` | 10 |
| `store/createOptimisticStore.test.ts` | 1 |
| `strict-read-pending-store.test.ts` | 1 |
| `strictRead.test.ts` | 2 |
| `syncThenable.test.ts` | 2 |
| `transitionEntanglement.test.ts` | 2 |
| `uninitialized-visibility.test.ts` | 3 |
| `gc.test.ts` | 1 |

All ordinary synchronous Store suites now pass. `createOptimistic` and several
pending/boundary files previously reached full passes but regressed after later
pending-state changes. Restore those semantics without reverting the newer
Store, snapshot, diagnostics, and production-link fixes.

Useful focused runs:

```sh
node scripts/upstream-signals-corpus.mjs --phase=sync
node scripts/upstream-signals-corpus.mjs --phase=async
node scripts/upstream-signals-corpus.mjs --phase=gc
node scripts/upstream-signals-corpus.mjs --phase=async --file=createOptimistic.test.ts --verbose
node scripts/upstream-signals-corpus.mjs --phase=async --file=question-scoped-pending.test.ts --verbose
node scripts/upstream-signals-corpus.mjs --phase=async --file=createLoadingBoundary.test.ts --verbose
```

Explicitly classified corpus gaps:

- `action-completion-race.test.ts`, `action-done-window.test.ts`, and
  `transitionMerge.test.ts` require the `activeTransition` scheduler test hook.
- `store/shallow.test.ts` requires the internal `markRaw` API.
- One reconcile performance invariant requires `symbolKeyedRecords` and
  `STORE_NODE` internals.
- `treeshake.test.ts` checks upstream TS/dist layout rather than runtime behavior;
  replace it with an equivalent package/tree-shaking gate rather than counting it
  as runtime behavior.
- Benchmarks and TypeScript-only files are classified separately.

### Browser Corpus

Last measured selected Solid client/Solid Web browser corpus:

```text
Selected assertions: 477 passed, 10 failed, 17 skipped, 504 total
Selected files:       28 passed,  3 failed
Inventory files:      86 explicitly skipped as server, SSR fixture, type-only,
                      benchmark, or currently unsupported harness scope
```

Command:

```sh
node scripts/upstream-web-corpus.mjs
```

The ten last-known failures were:

- Two snapshot-scope hydration write-retention cases.
- Three stylesheet route-swap reveal-gating cases.
- Top-level initial `isPending` render hold.
- Pending verdict during async rejection.
- Latest repeated async error display.
- Two implicit route-transition retention cases.

Rerun this corpus after every significant Signals scheduler change; the current
working tree has newer core changes than the last browser report.

### Focused Differential Tests

Last known state before the newest corpus changes:

- `test/upstream/store.test.mjs`: 4/4 passed.
- `test/upstream/solid-client-behavior.test.mjs`: 13/13 passed in development
  and production after production queue-shadow fixes.
- `test/upstream/dom-web.test.mjs`: hydration node-claim test passed; rerun the
  full file because the linker previously dropped transitive re-exports.
- `test/upstream/signals-dev.test.mjs`: 5/5 passed.
- `test/apps-e2e.test.mjs`: 21/21 prototype demo pairs passed at commit `448ada0`.

`test/upstream/signals.test.mjs` was reduced to three compile entries because the
large graph is expensive to compile. Its latest complete run is pending. The
public root required explicit wrappers for `refresh`, `resolve`, and `untrack`
because the current compiler can drop transitive re-export bindings.

### Production Compiler Constraint

`test/upstream/exact-production.toml` intentionally uses the no-optimization
preset. The maximal config in `src/lilscript.toml` has produced semantic
regressions in the combined graph, including dropped subscriptions and local
aliases shadowing module-global queues.

Source patterns such as this are unsafe with the current production lowering:

```text
SomeType[] local = moduleGlobalQueue;
moduleGlobalQueue = [];
```

Use direct counted loops plus `splice`, or helper functions taking the array as
an argument. Do not claim optimized production parity until maximal compilation
passes the same corpus.

The compiler repository is `/Users/yeargun/lilscript`, currently on
`compression-objective-lane` with extensive unrelated dirty work. Do not reset,
revert, or broadly stage it. The compiler binary used here is:

```text
/Users/yeargun/lilscript/target/release/lilscript
```

## Implementation Layout

- `src/upstream/_host.lil`: shared ambient host declarations.
- `src/upstream/solid-signals/src/core/kernel.lil`: cycle-breaking typed core
  implementation kernel.
- `src/upstream/solid-signals/src/core/*.lil`: source-named facades.
- `src/upstream/solid-signals/src/store/_kernel.lil`: typed Store implementation.
- `src/upstream/solid-signals/src/store/*.lil`: seven source-named Store files.
- `src/upstream/solid/src/`: five Solid client files.
- `src/upstream/solid-web/src/`: five Solid Web files.
- `src/upstream/dom-expressions/runtime/`: seven DOM Expressions files.
- `test/upstream/`: focused compile, differential, browser, and corpus entries.
- `scripts/upstream-signals-corpus.mjs`: pinned Vitest corpus redirector.
- `scripts/upstream-web-corpus.mjs`: transformed TSX/Playwright browser corpus.

The SCC kernels are a deliberate workaround for compiler module-cycle limits.
Every upstream filename still exists and all runtime logic remains in `.lil`.

## Important Fixes Already Landed Locally

- Added all 47 mirrored source files.
- Replaced npm Signals and `solid-js` runtime bridges with the local typed graph.
- Centralized duplicate host declarations.
- Linked Signals, Store, Solid client, Solid Web, and DOM Expressions together.
- Implemented contexts, effects, reactions, roots, graph ordering, cleanup,
  diagnostics, external sources, snapshots, stores, reconciliation, projections,
  actions, optimistic stores, flow controls, hydration, events, portals, head
  assets, cookies, responses, and server-function metadata.
- Fixed plain structural hydration contexts (`{ id, defaultValue }`).
- Fixed provider context, children caching, component owner metadata, lazy pending
  errors, hydration IDs, and hydration completion.
- Fixed sequential Reveal behavior and later expanded boundary queue behavior.
- Fixed production queue-shadow failures by avoiding direct local aliases of
  module-global pending/deferred arrays.
- Fixed all ordinary synchronous Store corpus failures.
- Added broad executable upstream corpus harnesses instead of relying on demos.

## Current Worktree State

- Repository: `/Users/yeargun/solidlil`
- Branch: `main`
- Last committed/pushed revision: `448ada0 Exercise every demo in Playwright`
- The entire exact-port tranche is currently uncommitted.
- Some early DOM/Web additions are staged while later work is unstaged.
- Do not reset or discard the mixed staging state. Inspect and stage the intended
  complete tranche before committing.
- `site/upstream-port.json` and some generated evidence files have changed.

Always inspect first:

```sh
git status --short --branch
git diff --check
git diff --cached --check
git diff --stat
git diff --cached --stat
```

## Todo List

- [x] Pin Solid and DOM Expressions source revisions.
- [x] Inventory 47 browser-runtime modules.
- [x] Create all 47 source-aligned typed `.lil` files.
- [x] Remove npm runtime implementation delegation from the source-aligned graph.
- [x] Link Signals, Store, Solid client, Solid Web, and DOM Expressions locally.
- [x] Add focused Signals/Store/Solid client/DOM differential tests.
- [x] Add executable pinned Signals and browser corpus harnesses.
- [x] Reach 100% on ordinary synchronous Store corpus files.
- [ ] Restore `createOptimistic.test.ts` to 68/68 without regressing Store fixes.
- [ ] Restore `createMemo.test.ts` to 80/80.
- [ ] Finish pending/loading/question-scoped semantics.
- [ ] Finish strict-read, uninitialized visibility, affects, and autodispose cases.
- [ ] Finish remaining Loading/Reveal boundary cases.
- [ ] Finish the one optimistic Store case and GC case.
- [ ] Port scheduler test hooks and Store internals currently classified incompatible.
- [ ] Make all applicable Signals runtime files pass.
- [ ] Rerun and close the ten last-known selected browser failures.
- [ ] Run all focused tests in development and exact-production modes.
- [ ] Fix maximal optimizer semantics and run the same corpus under
  `src/lilscript.toml`.
- [ ] Mark files verified individually only when their relevant corpus is green.
- [ ] Reach `47/47 verified`, `0 unverified`, `0 missing`.
- [ ] Switch package entries from the prototype to the source-aligned runtime.
- [ ] Rebuild all 21 app pairs and rerun Playwright E2E.
- [ ] Rebuild package, JFB, size, and performance artifacts.
- [ ] Publish compression/performance rankings only after the exact gate passes.
- [ ] Commit, push, deploy, and verify GitHub Pages.

## Immediate Next Steps

1. Run focused `createOptimistic.test.ts --verbose` and compare the current
   scheduler with the last state where it passed 68/68. Preserve the newer
   Store snapshot/projection fixes.
2. Fix `createMemo`, loading, and question-scoped pending regressions one file at
   a time; rerun each focused file before the full corpus.
3. Rerun `test/upstream/store.test.mjs`,
   `test/upstream/solid-client-behavior.test.mjs`, and the full DOM/Web focused
   suite after scheduler changes.
4. Rerun both full corpus scripts and record fresh JSON evidence.
5. Refresh GitHub Pages immediately with honest progress: 47 files present,
   0 verified, corpus counts visible, and comparisons withheld.

## GitHub Pages Refresh

The live site currently reflects commit `448ada0`; the exact-port source and
latest corpus progress are not deployed yet.

Before deployment:

1. Add generated corpus summary JSON to `site/` and render it as progress, not
   compatibility proof.
2. Run `npm run audit:upstream` so `site/upstream-port.json` is current.
3. Bump site fetch cache keys from `exact2` to a new value.
4. Run `npm run check:site`, `git diff --check`, and relevant focused tests.
5. Commit the intended SolidLil files only.
6. Push `main` and watch `.github/workflows/pages.yml`:

```sh
git push origin main
gh run list --workflow pages.yml --limit 1
gh run watch <run-id> --exit-status
```

7. Verify live evidence:

```text
https://yeargun.github.io/solidlil/upstream-port.json
https://yeargun.github.io/solidlil/demo-e2e.json
https://yeargun.github.io/solidlil/
```

## Continuation Prompt

Pass this prompt to the next coding session:

```text
Continue the exact Solid 2 browser runtime port in /Users/yeargun/solidlil.
Read EXACT_PORT_PROGRESS.md first and treat it as the handoff source of truth.
Inspect git status and both staged/unstaged diffs without resetting anything.

The hard rule is behavioral exactness: do not mark any of the 47 modules verified
until its applicable pinned upstream tests pass against local typed LilScript with
no npm runtime implementation delegation. Internal representation may differ.

Start by rerunning focused createOptimistic, createMemo, Loading, and
question-scoped-pending corpus files. Restore previously passing behavior without
regressing the now-green synchronous Store corpus. Then rerun both full corpus
harnesses, focused development/production tests, and update the progress counts.

Also refresh and deploy yeargun.github.io/solidlil with honest current progress:
47 source files present, 0 verified until strict completion, corpus counts shown,
and all size/performance comparisons withheld. Commit and push only after checks
pass; watch the Pages workflow and verify the live JSON/page.
```
