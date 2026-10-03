# Current comparison with the original

Experimental Solid 2 compatibility runtime including embedded JavaScript providers, compared with the original shared main-entry API. Important scheduling, hydration, DOM and server semantics remain incomplete; these bytes do not establish equivalent features or compiler-only savings.

Each compression row uses a separate LilScript compilation targeting that objective. Original results are the smallest of Terser, esbuild and Oxc for the named codec.

| Objective | LilScript bytes | Original minified bytes | Original minifier | LilScript build (s) | Original bundle + minify (s) |
|---|---:|---:|---|---:|---:|
| raw | 33,732 | 76,862 | Oxc | 16.353 | 0.231 |
| gzip | 9,591 | 27,284 | Oxc | 41.961 | 0.231 |
| brotli | 8,629 | 24,632 | Terser | 124.562 | 1.410 |

Original version: `solid-js@2.0.0-rc.0`. gzip level 9; Brotli quality 11/window 22. Each time is one sequential fresh-output build on the recorded shared machine. Original timing starts from installed ESM and does not include the original repository’s TypeScript compilation. Dependency installation, tests and final file compression are excluded.

Validation: 45 checks across raw, gzip and Brotli main entries. This does not cover every package format or establish complete upstream API equivalence.

[Artifacts, hashes and settings](site/comparison.json) · [Commands, source identities and timings](site/comparison-builds.json) · [Exact checked source inputs](site/comparison-artifacts/sources.tar.gz).
