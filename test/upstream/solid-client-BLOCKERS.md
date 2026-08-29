# Solid client port blockers

- The five modules statically import `src/upstream/solid-signals/src/index.lil`.
  That separately assigned source graph is not present yet, so the compile-entry
  test reports a skip instead of substituting the prototype runtime or an npm
  JavaScript implementation.
- LilScript does not currently express TypeScript conditional/intersection
  aliases or overload-only declarations. Callable JavaScript public values
  (components, accessors, contexts, and overloaded primitive wrappers) therefore
  use the explicit `JsValue` boundary while retaining their runtime export names
  and function arities. Package `.d.ts` parity remains a separate declaration
  gate.
- The upstream `IS_DEV` token is replaced by its build. This port currently
  selects the production value (`false`); a source-equivalent development build
  needs a LilScript build-time boolean substitution facility.
- These files remain unverified in `upstream.lock.json` until the signals graph
  compiles and the pinned Solid client/hydration suites pass differentially.
