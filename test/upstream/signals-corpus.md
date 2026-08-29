# Upstream solid-signals corpus harness

Run the pinned upstream runtime corpus against the compiled typed LilScript candidate:

```sh
node scripts/upstream-signals-corpus.mjs
```

The harness verifies the pinned checkout revision, compiles `signals-corpus-entry.lil` in development mode, rejects emitted npm-runtime references, and redirects upstream `src` imports to that output through Vitest. It uses the Vitest installation under `../lilscript/labs/solid-client` and automatically selects an installed Node 22+ runtime for Vite 8.

Files run in isolated processes, in this order:

1. Synchronous core, context, signal, effect, map, and store tests.
2. Async, action, optimistic, pending, and boundary tests.
3. `gc.test.ts` under `--expose-gc`.
4. Incompatible files in collection-only mode so their skipped test counts remain visible.

If a file hangs, the harness collects its test names and bisects isolated test-name groups. This executes non-hanging siblings and reports an irreducible hanging test as a timeout failure.

Useful filters:

```sh
node scripts/upstream-signals-corpus.mjs --phase=sync
node scripts/upstream-signals-corpus.mjs --phase=async
node scripts/upstream-signals-corpus.mjs --phase=gc
node scripts/upstream-signals-corpus.mjs --file=context.test.ts --phase=sync
node scripts/upstream-signals-corpus.mjs --verbose
```

Explicit non-runtime classifications:

- `*.bench.ts`: benchmark corpus, not correctness tests.
- `store/store.type-tests.ts`: TypeScript type-only contract; the candidate has no TypeScript declaration surface.
- `store/shared-clone.ts`: helper imported by a runtime test.
- Scheduler transition-hook tests: require the unported `activeTransition` internal.
- `store/shallow.test.ts`: requires the unported internal `markRaw` API.
- One `store/reconcile.test.ts` case: requires unported `symbolKeyedRecords` and `STORE_NODE` internals; all other cases in the file execute.
- `treeshake.test.ts`: asserts the upstream TypeScript source graph and dist layout rather than candidate runtime behavior.

No upstream source, candidate source, installed npm implementation, or existing test file is modified or used as a runtime implementation.
