import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const testsRoot = fileURLToPath(
  new URL("../../upstream/solid/packages/solid-signals/tests/", import.meta.url),
);
const candidate = process.env.SOLIDLIL_SIGNALS_CORPUS_CANDIDATE;
const vitestModule = process.env.SOLIDLIL_SIGNALS_CORPUS_VITEST_MODULE;

if (!candidate || !vitestModule) {
  throw new Error("signals corpus config must be launched by scripts/upstream-signals-corpus.mjs");
}

const incompatibleFiles = new Set(
  JSON.parse(process.env.SOLIDLIL_SIGNALS_CORPUS_INCOMPATIBLE ?? "[]"),
);
const reconcileTest = "store/reconcile.test.ts";
const reconcileInternalCase =
  'test("perf invariant: symbol-record mark is set while tracked and cleared once unobserved", async () => {';

function relativeTestPath(id) {
  const clean = id.split("?", 1)[0];
  if (!clean.startsWith(testsRoot)) return null;
  return clean.slice(testsRoot.length).replaceAll("\\", "/");
}

export default {
  root,
  define: {
    __DEV__: "true",
    __TEST__: "true",
  },
  resolve: {
    alias: [{ find: /^vitest$/, replacement: vitestModule }],
  },
  plugins: [
    {
      name: "solidlil-signals-corpus",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer || !relativeTestPath(importer)) return null;
        if (!/^\.\.\/src\/|^\.\.\/\.\.\/src\//.test(source)) return null;
        if (source.endsWith("/store/store.js")) return "\0solidlil-signals-store-internals";
        return candidate;
      },
      load(id) {
        if (id !== "\0solidlil-signals-store-internals") return null;
        const specifier = JSON.stringify(pathToFileURL(candidate).href);
        return [
          `export { $TARGET } from ${specifier};`,
          "export const markRaw = value => value;",
          'export const STORE_NODE = "n";',
          "export const symbolKeyedRecords = new WeakSet();",
        ].join("\n");
      },
      transform(code, id) {
        const relative = relativeTestPath(id);
        if (!relative) return null;
        if (incompatibleFiles.has(relative)) {
          return {
            code: code
              .replace(/\b(describe|it|test)\.each\s*\(/g, "$1.skip.each(")
              .replace(/\b(describe|it|test)\s*\(/g, "$1.skip("),
            map: null,
          };
        }
        if (relative === reconcileTest) {
          if (!code.includes(reconcileInternalCase)) {
            throw new Error(`upstream case changed: ${reconcileInternalCase}`);
          }
          return { code: code.replace(reconcileInternalCase, `test.skip(${reconcileInternalCase.slice(5)}`), map: null };
        }
        return null;
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    isolate: true,
    pool: "forks",
    execArgv: process.env.SOLIDLIL_SIGNALS_CORPUS_GC === "1" ? ["--expose-gc"] : [],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false, shuffle: false },
  },
};
