# Pinned browser corpus

Run the applicable Solid client and Solid Web tests against one compiled
LilScript module graph:

```sh
node scripts/upstream-web-corpus.mjs
```

The runner verifies `upstream/solid` against `upstream.lock.json`, compiles
`web-corpus-entry.lil`, transforms the unmodified pinned TS/TSX tests with the
pinned DOM Expressions compiler, bundles each file with esbuild, and executes
it in an isolated Playwright page. Results are written to
`test-output/upstream-web-corpus.json`; a nonzero exit status means a selected
file failed to build, emitted an uncaught page error, registered no tests, or
had a failing test.

`web-corpus.manifest.mjs` is the explicit scope ledger. Every discovered spec,
type test, and benchmark is either selected or reported with one of these skip
categories:

- `server`: SSR/server runtime suite
- `ssr-fixture`: browser hydration suite requiring generated server or frame artifacts
- `type`: compile-time TypeScript suite
- `bench`: benchmark rather than a behavioral test
- `unsupported`: client subsystem absent from the compiled typed entries

The small browser runner implements only the Vitest APIs used by the selected
files. It intentionally does not alter or copy upstream tests.
