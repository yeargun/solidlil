import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformAsync as transformJsx } from "@dom-expressions/compiler";
import { build } from "esbuild";
import { chromium } from "playwright";
import { classify, runnable } from "../test/upstream/web-corpus.manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamRoot = resolve(root, "upstream/solid");
const compiler = process.env.SOLIDLIL_LILSCRIPT_BIN
  ?? resolve(root, "../lilscript/target/release/lilscript");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputJson = resolve(root, "test-output/upstream-web-corpus.json");
const apiNames = [
  "$DEVCOMP", "$PROXY", "$REFRESH", "$TRACK", "DEV", "Dynamic", "Errored", "For", "Hydration",
  "Loading", "Match", "NoHydrateContext", "NoHydration", "NotReadyError", "Portal", "Repeat", "Reveal",
  "Show", "Switch", "action", "addEvent", "affects", "applyRef", "assign", "children", "className",
  "clientOnly", "createComponent", "createContext", "createEffect", "createErrorBoundary",
  "createLoadingBoundary", "createMemo", "createOptimistic", "createOptimisticStore", "createOwner",
  "createProjection", "createReaction", "createRenderEffect", "createRoot", "createSignal", "createStore",
  "createTrackedEffect", "createUniqueId", "deep", "delegateEvents", "dynamic", "dynamicProperty", "effect",
  "enableExternalSource", "enableHydration", "enforceLoadingBoundary", "flatten", "flush", "getFirstChild", "getHydrationKey",
  "getNextChildId", "getNextElement", "getNextMarker", "getNextMatch", "getNextSibling", "getObserver",
  "getOwner", "hydrate", "insert", "isDisposed", "isEqual", "isPending", "isWrappable", "latest", "lazy",
  "mapArray", "materializeContainerTrace", "memo", "merge", "mergeProps", "omit", "onCleanup", "onSettled",
  "reconcile", "ref", "refresh", "registerDelegatedContainer", "registerDelegatedRoot", "registerElementClaim", "render", "repeat",
  "resolve", "runHydrationEvents", "runWithOwner", "scope", "setAttribute", "setAttributeNS", "setProperty", "setStyleProperty", "sharedConfig",
  "snapshot", "spread", "storePath", "style", "template", "unregisterDelegatedContainer",
  "unregisterDelegatedRoot", "untrack", "useContext", "useHead", "waitAsset", "warmAsset",
];

function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function corpusFiles() {
  return Promise.all([
    walk(resolve(upstreamRoot, "packages/solid/test")),
    walk(resolve(upstreamRoot, "packages/solid-web/test")),
  ]).then(groups => groups.flat()
    .map(path => relative(upstreamRoot, path).replaceAll("\\", "/"))
    .filter(path => /(?:\.spec\.[^.]+|\.type-tests\.[^.]+|\.bench\.[^.]+|\/no-dom\/core-types\.ts)$/.test(path))
    .sort());
}

function compileCandidate(output) {
  const target = join(output, "candidate.mjs");
  execFileSync(
    compiler,
    [
      resolve(root, "test/upstream/web-corpus-entry.lil"),
      "--target", "js-module",
      "--config", resolve(root, "test/upstream/dom-web-oracle.toml"),
      "--mode", "production",
      "--output", target,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  return target;
}

async function writeApiModule(output, candidate) {
  const target = join(output, "candidate-api.mjs");
  const declarations = apiNames.map(name => `export const ${name} = api[${JSON.stringify(name)}];`).join("\n");
  await writeFile(target, `import { webCorpusApi } from ${JSON.stringify(candidate)};\nconst api = webCorpusApi();\n${declarations}\n`);
  return target;
}

function testAliasPlugin(apiModule, testFile) {
  const shim = resolve(root, "test/upstream/web-corpus-vitest.js");
  const solidSource = resolve(upstreamRoot, "packages/solid/src");
  const webSource = resolve(upstreamRoot, "packages/solid-web/src");
  return {
    name: "solidlil-web-corpus-alias",
    setup(buildContext) {
      buildContext.onResolve({ filter: /.*/ }, args => {
        if (args.path === testFile) return { path: testFile, sideEffects: true };
        return null;
      });
      buildContext.onResolve({ filter: /^vitest$/ }, () => ({ path: shim }));
      buildContext.onResolve({ filter: /^(solid-js|@solidjs\/signals|@solidjs\/web)$/ }, () => ({ path: apiModule }));
      buildContext.onResolve({ filter: /^\./ }, args => {
        const resolved = resolve(args.resolveDir, args.path);
        if (resolved.startsWith(solidSource) || resolved.startsWith(webSource)) return { path: apiModule };
        return null;
      });
    },
  };
}

async function bundleTest(testFile, apiModule, options) {
  const jsxPlugin = {
    name: "solid-jsx",
    setup(buildContext) {
      buildContext.onLoad({ filter: /\.[cm]?[jt]sx$/ }, async args => {
        const source = await readFile(args.path, "utf8");
        const transformed = await transformJsx(source, {
          filename: args.path,
          moduleName: "@solidjs/web",
          generate: "dom",
          hydratable: testFile.includes("/test/hydration/"),
          dev: true,
          sourceMap: false,
          contextToCustomElements: true,
          wrapConditionals: true,
          builtIns: ["For", "Show", "Switch", "Match", "Loading", "Reveal", "Portal", "Repeat", "Dynamic", "Errored"],
        });
        return { contents: transformed.code, loader: "ts", resolveDir: dirname(args.path) };
      });
    },
  };
  const entry = `import ${JSON.stringify(testFile)};
import { runCorpusTests } from ${JSON.stringify(resolve(root, "test/upstream/web-corpus-vitest.js"))};
globalThis.__runWebCorpus = () => runCorpusTests(${JSON.stringify(options)});`;
  const result = await build({
    stdin: { contents: entry, loader: "js", resolveDir: root },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
    sourcemap: "inline",
    plugins: [testAliasPlugin(apiModule, testFile), jsxPlugin],
    conditions: ["browser", "import"],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  const output = result.outputFiles?.find(file => file.path.endsWith("<stdout>")) ?? result.outputFiles?.[0];
  if (!output) throw new Error("esbuild produced no browser bundle");
  return output.text;
}

async function main() {
  if (!existsSync(compiler)) throw new Error(`LilScript compiler not found at ${compiler}`);
  if (!existsSync(resolve(upstreamRoot, ".git"))) throw new Error("pinned upstream checkout is missing; run npm run setup:upstream");

  const lock = JSON.parse(await readFile(resolve(root, "upstream.lock.json"), "utf8"));
  const revision = run("git", ["rev-parse", "HEAD"], upstreamRoot);
  if (revision !== lock.solid.revision) {
    throw new Error(`upstream/solid is ${revision}; expected pinned ${lock.solid.revision}`);
  }

  const inventory = await corpusFiles();
  const classified = inventory.map(file => ({ file, ...classify(file) }));
  const missing = Object.keys(runnable).filter(file => !inventory.includes(file));
  if (missing.length) throw new Error(`manifest entries missing from pinned checkout: ${missing.join(", ")}`);

  const output = await mkdtemp(join(tmpdir(), "solidlil-web-corpus-"));
  let browser;
  const fileResults = [];
  try {
    const candidate = compileCandidate(output);
    const apiModule = await writeApiModule(output, candidate);
    browser = await chromium.launch({
      headless: true,
      ...(existsSync(chromePath) ? { executablePath: chromePath, args: ["--headless=new"] } : {}),
    });

    for (const [file, options] of Object.entries(runnable)) {
      const started = performance.now();
      try {
        const code = await bundleTest(resolve(upstreamRoot, file), apiModule, options);
        const page = await browser.newPage();
        const pageErrors = [];
        page.on("pageerror", error => pageErrors.push(error.stack ?? error.message));
        try {
          await page.setContent("<!doctype html><html><head></head><body></body></html>");
          const script = await page.addScriptTag({ content: code });
          await script.evaluate(node => node.remove());
          const tests = await page.evaluate(async () => globalThis.__runWebCorpus());
          const failed = tests.some(item => item.status === "fail") || pageErrors.length > 0 || tests.length === 0;
          fileResults.push({ file, status: failed ? "fail" : "pass", tests, pageErrors });
        } finally {
          await page.close();
        }
      } catch (error) {
        fileResults.push({
          file,
          status: "fail",
          buildError: error instanceof Error ? error.message : String(error),
          tests: [],
          pageErrors: [],
        });
      }
      const result = fileResults.at(-1);
      const counts = result.tests.reduce((acc, item) => (acc[item.status]++, acc), { pass: 0, fail: 0, skip: 0 });
      console.log(`${result.status.toUpperCase().padEnd(4)} ${file} (${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip, ${Math.round(performance.now() - started)}ms)`);
    }
  } finally {
    await browser?.close();
    await rm(output, { recursive: true, force: true });
  }

  const skippedFiles = classified.filter(item => item.status === "skip");
  const tests = fileResults.flatMap(item => item.tests);
  const summary = {
    files: {
      pass: fileResults.filter(item => item.status === "pass").length,
      fail: fileResults.filter(item => item.status === "fail").length,
      skip: skippedFiles.length,
      total: classified.length,
    },
    tests: {
      pass: tests.filter(item => item.status === "pass").length,
      fail: tests.filter(item => item.status === "fail").length,
      skip: tests.filter(item => item.status === "skip").length,
      total: tests.length,
    },
  };
  const report = {
    generatedAt: new Date().toISOString(),
    upstream: { revision, tag: lock.solid.tag },
    summary,
    files: fileResults,
    outOfScope: skippedFiles,
  };
  await mkdir(dirname(outputJson), { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nFiles: ${summary.files.pass} pass, ${summary.files.fail} fail, ${summary.files.skip} skip (${summary.files.total} classified)`);
  console.log(`Tests: ${summary.tests.pass} pass, ${summary.tests.fail} fail, ${summary.tests.skip} skip (${summary.tests.total} executed/selected)`);
  const categories = {};
  for (const item of skippedFiles) (categories[item.category] ??= []).push(item);
  for (const [category, entries] of Object.entries(categories)) console.log(`Out of scope ${category}: ${entries.length}`);
  console.log(`Report: ${relative(root, outputJson)}`);
  if (summary.files.fail || summary.tests.fail) process.exitCode = 1;
}

await main();
