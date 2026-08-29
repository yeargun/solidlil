export const runnable = {
  "packages/solid/test/signals.spec.ts": {},
  "packages/solid/test/component.spec.ts": {
    skipTests: ["Strict Read Warning"],
    skipReason: "typed entries currently pin IS_DEV=false",
  },
  "packages/solid/test/client-hydration.spec.ts": {
    timeoutMs: 20000,
  },
  "packages/solid/test/multi-root-hydration.spec.ts": {},
  "packages/solid/test/container-trace.spec.ts": {},
  "packages/solid/test/public-boundary-exports.spec.ts": {},
  "packages/solid-web/test/element.spec.tsx": {
    skipTests: [
      "conditional callback prop read",
      "onCleanup warns",
    ],
    skipReason: "typed entries currently pin IS_DEV=false",
  },
  "packages/solid-web/test/portal.spec.tsx": {
    skipTests: [
      "reactive portal children create no ownerless effects",
      "changing mount disposes the previous insert effect",
    ],
    skipReason: "typed entries currently pin IS_DEV=false",
  },
  "packages/solid-web/test/dynamic.spec.tsx": {},
  "packages/solid-web/test/for.spec.tsx": {},
  "packages/solid-web/test/for.nonkeyed.spec.tsx": {},
  "packages/solid-web/test/for.nonkeyed.store.spec.tsx": {},
  "packages/solid-web/test/repeat.spec.tsx": {},
  "packages/solid-web/test/show.spec.tsx": {},
  "packages/solid-web/test/switch.spec.tsx": {},
  "packages/solid-web/test/context.spec.tsx": {},
  "packages/solid-web/test/errored.spec.tsx": {},
  "packages/solid-web/test/errored-async-nesting.spec.tsx": {},
  "packages/solid-web/test/client-only.spec.tsx": {},
  "packages/solid-web/test/wait-asset.spec.tsx": {},
  "packages/solid-web/test/halt-error-logging.spec.tsx": {},
  "packages/solid-web/test/latest-async.spec.tsx": {},
  "packages/solid-web/test/show-in-for.spec.tsx": {},
  "packages/solid-web/test/use-head-loading-client.spec.tsx": {},
  "packages/solid-web/test/use-head-css-gating-client.spec.tsx": {},
  "packages/solid-web/test/loading.spec.tsx": {
    timeoutMs: 20000,
  },
  "packages/solid-web/test/hydration/show-fallback.spec.tsx": {},
  "packages/solid-web/test/hydration/spread-innerhtml.spec.tsx": {},
  "packages/solid-web/test/hydration/insert-refresh-drift.spec.tsx": {},
  "packages/solid-web/test/hydration/multi-root-registry.spec.tsx": {},
  "packages/solid-web/test/hydration/loading-late-fragment.spec.tsx": {},
};

export function classify(relativePath) {
  if (runnable[relativePath]) return { status: "run" };
  if (/\.type-tests\.[^.]+$/.test(relativePath) || relativePath.endsWith("/no-dom/core-types.ts")) {
    return { status: "skip", category: "type", reason: "compile-time TypeScript suite" };
  }
  if (/\.bench\.[^.]+$/.test(relativePath)) {
    return { status: "skip", category: "bench", reason: "benchmark, not a behavioral browser test" };
  }
  if (relativePath.includes("/test/server/") || relativePath.endsWith("/server-mock.spec.tsx")) {
    return { status: "skip", category: "server", reason: "SSR/server suite" };
  }
  if (relativePath.includes("refresh")) {
    return { status: "skip", category: "unsupported", reason: "solid-js/refresh is not present in the typed client entry" };
  }
  if (relativePath.includes("frames-") || relativePath.includes("/lifecycle-matrix/")) {
    return { status: "skip", category: "unsupported", reason: "frames/serialization client subsystem is not ported" };
  }
  if (relativePath.endsWith("/dev.spec.ts") || relativePath.endsWith("/dev-warning.spec.tsx")) {
    return { status: "skip", category: "unsupported", reason: "typed entries currently pin IS_DEV=false" };
  }
  if (relativePath.endsWith("/id-parity.spec.ts")) {
    return { status: "skip", category: "unsupported", reason: "devComponent is internal and the typed entries pin IS_DEV=false" };
  }
  if (relativePath.endsWith("/reveal.spec.ts")) {
    return { status: "skip", category: "unsupported", reason: "createRevealOrder is not exported by the typed Solid client entry" };
  }
  if (relativePath.includes("/test/hydration/")) {
    return { status: "skip", category: "ssr-fixture", reason: "client suite requires generated SSR/frame artifacts or Node filesystem access" };
  }
  return { status: "skip", category: "unsupported", reason: "browser surface is not exported by the compiled typed entries" };
}
