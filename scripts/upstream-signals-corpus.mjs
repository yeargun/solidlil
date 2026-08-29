import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = join(root, "upstream/solid/packages/solid-signals/tests");
const config = join(root, "test/upstream/signals-corpus.vitest.mjs");
const entry = join(root, "test/upstream/signals-corpus-entry.lil");
const lock = JSON.parse(await readFile(join(root, "upstream.lock.json"), "utf8"));
const compiler = [
  process.env.SOLIDLIL_LILSCRIPT_BIN,
  resolve(root, "../lilscript/target/release/lilscript"),
  "lilscript",
].filter(Boolean).find(command => command === "lilscript" || existsSync(command));
const vitestRoot = process.env.SOLIDLIL_VITEST_ROOT
  ? resolve(process.env.SOLIDLIL_VITEST_ROOT)
  : resolve(root, "../lilscript/labs/solid-client/node_modules/vitest");
const vitestCli = join(vitestRoot, "vitest.mjs");
const vitestModule = join(vitestRoot, "dist/index.js");
const nvmVersions = join(homedir(), ".nvm/versions/node");
const installedNodes = existsSync(nvmVersions)
  ? (await readdir(nvmVersions))
      .filter(version => /^v(?:2[2-9]|[3-9]\d)\./.test(version))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map(version => join(nvmVersions, version, "bin/node"))
  : [];
const testNode = [process.env.SOLIDLIL_NODE_BIN, ...installedNodes, process.execPath]
  .filter(Boolean)
  .find(command => existsSync(command));

if (!compiler) throw new Error("LilScript compiler not found; set SOLIDLIL_LILSCRIPT_BIN");
if (!existsSync(vitestCli) || !existsSync(vitestModule)) {
  throw new Error(`Vitest not found under ${vitestRoot}; set SOLIDLIL_VITEST_ROOT`);
}

const incompatible = new Map([
  ["action-completion-race.test.ts", "requires the unported scheduler.activeTransition test hook"],
  ["action-done-window.test.ts", "requires the unported scheduler.activeTransition test hook"],
  ["transitionMerge.test.ts", "requires the unported scheduler.activeTransition test hook"],
  ["store/shallow.test.ts", "requires the unported internal markRaw API"],
  ["treeshake.test.ts", "asserts upstream TypeScript module layout and dist artifacts, not runtime behavior"],
]);
const partialIncompatible = new Map([
  [
    "store/reconcile.test.ts :: perf invariant: symbol-record mark is set while tracked and cleared once unobserved",
    "requires unported symbolKeyedRecords and STORE_NODE internals",
  ],
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

const revision = run("git", ["rev-parse", "HEAD"], { cwd: join(root, lock.solid.checkout) });
if (revision.status !== 0 || revision.stdout.trim() !== lock.solid.revision) {
  throw new Error(
    `upstream checkout is not pinned at ${lock.solid.revision}: ${revision.stderr || revision.stdout}`,
  );
}

await mkdir(join(root, ".tmp"), { recursive: true });
const temp = await mkdtemp(join(root, ".tmp/signals-corpus-"));
const candidate = join(temp, "candidate.mjs");

const compile = run(compiler, [
  entry,
  "--target", "js-module",
  "--mode", "development",
  "--output", candidate,
]);
if (compile.status !== 0) {
  await rm(temp, { recursive: true, force: true });
  throw new Error(compile.stderr || compile.stdout || "candidate compilation failed");
}

const emitted = await readFile(candidate, "utf8");
if (/@solidjs\/signals|node_modules/.test(emitted)) {
  await rm(temp, { recursive: true, force: true });
  throw new Error("compiled candidate delegates to an npm runtime");
}

const allFiles = (await walk(testsRoot))
  .filter(file => file.endsWith(".ts"))
  .map(file => relative(testsRoot, file).replaceAll("\\", "/"))
  .sort();
const benchmarks = allFiles.filter(file => file.endsWith(".bench.ts"));
const typeOnly = allFiles.filter(file => file.endsWith(".type-tests.ts"));
const helpers = allFiles.filter(file => !file.endsWith(".test.ts") && !benchmarks.includes(file) && !typeOnly.includes(file));
const runtime = allFiles.filter(file => file.endsWith(".test.ts"));
const gc = runtime.filter(file => file === "gc.test.ts");
const incompatibleFiles = runtime.filter(file => incompatible.has(file));
const executable = runtime.filter(file => file !== "gc.test.ts" && !incompatible.has(file));
const asyncName = /(?:^|\/)(?:.*\.async\.test|action|affects|autodispose|createErrorBoundary|createLoadingBoundary|createOptimistic|createRevealOrder|enforceLoadingBoundary|latest|loading|optimistic|question-scoped-pending|resolve|reveal|spec-async|strict-read|strictRead|syncThenable|transition|uninitialized|untracked-async)/i;
const asyncFiles = executable.filter(file => asyncName.test(file));
const synchronousFiles = executable.filter(file => !asyncName.test(file));

const requestedPhase = process.argv.find(argument => argument.startsWith("--phase="))?.slice(8);
const requestedFile = process.argv.find(argument => argument.startsWith("--file="))?.slice(7);
const verbose = process.argv.includes("--verbose");
const validPhases = new Set(["sync", "async", "gc", "incompatible"]);
if (requestedPhase && !validPhases.has(requestedPhase)) {
  throw new Error(`unknown phase ${requestedPhase}; expected ${[...validPhases].join(", ")}`);
}

const phases = [
  ["sync", synchronousFiles, false],
  ["async", asyncFiles, false],
  ["gc", gc, true],
  ["incompatible", incompatibleFiles, false],
].filter(([name]) => !requestedPhase || name === requestedPhase);

function invokeVitest(file, exposeGc, report, options = {}) {
  const args = [
    ...(exposeGc ? ["--expose-gc"] : []),
    vitestCli,
    "run",
    "--config", config,
    "--reporter=json",
    "--outputFile", report,
    ...(options.pattern ? ["--testNamePattern", options.pattern] : []),
    join(testsRoot, file),
  ];
  return run(testNode, args, {
    env: {
      ...process.env,
      SOLIDLIL_SIGNALS_CORPUS_CANDIDATE: candidate,
      SOLIDLIL_SIGNALS_CORPUS_VITEST_MODULE: vitestModule,
      SOLIDLIL_SIGNALS_CORPUS_INCOMPATIBLE: JSON.stringify(options.skipFiles ?? incompatibleFiles),
      SOLIDLIL_SIGNALS_CORPUS_GC: exposeGc ? "1" : "0",
    },
    timeout: options.timeout ?? 30_000,
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function isolateTimedOutFile(name, file, exposeGc, sequence) {
  const collectionPath = join(temp, `${name}-${sequence}-collection.json`);
  const collection = invokeVitest(file, exposeGc, collectionPath, {
    skipFiles: [file],
    timeout: 30_000,
  });
  if (!existsSync(collectionPath)) return null;
  const collected = JSON.parse(await readFile(collectionPath, "utf8"));
  const names = collected.testResults
    .flatMap(result => result.assertionResults ?? [])
    .map(assertion => assertion.fullName);
  if (names.length === 0) return null;

  const assertions = new Map();
  let runNumber = 0;
  async function execute(group) {
    const reportPath = join(temp, `${name}-${sequence}-isolated-${runNumber++}.json`);
    const pattern = `^(?:${group.map(escapeRegex).join("|")})$`;
    const outcome = invokeVitest(file, exposeGc, reportPath, { pattern, timeout: 15_000 });
    if (existsSync(reportPath)) {
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      const selected = new Set(group);
      for (const assertion of report.testResults.flatMap(result => result.assertionResults ?? [])) {
        if (selected.has(assertion.fullName)) assertions.set(assertion.fullName, assertion);
      }
      for (const fullName of group) {
        if (!assertions.has(fullName)) {
          assertions.set(fullName, {
            fullName,
            title: fullName,
            status: "failed",
            failureMessages: ["Harness failed to select the collected upstream test"],
          });
        }
      }
      return;
    }
    if (group.length > 1) {
      const middle = Math.ceil(group.length / 2);
      await execute(group.slice(0, middle));
      await execute(group.slice(middle));
      return;
    }
    assertions.set(group[0], {
      fullName: group[0],
      title: group[0],
      status: "failed",
      failureMessages: ["Candidate process timeout after 15s"],
    });
  }

  for (let start = 0; start < names.length; start += 16) {
    await execute(names.slice(start, start + 16));
  }
  const ordered = names.map(fullName => assertions.get(fullName));
  const passed = ordered.filter(assertion => assertion.status === "passed").length;
  const failed = ordered.filter(assertion => assertion.status === "failed").length;
  const skipped = ordered.filter(assertion => assertion.status === "pending" || assertion.status === "skipped").length;
  return {
    numTotalTests: ordered.length,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: skipped,
    testResults: [{
      name: join(testsRoot, file),
      status: failed ? "failed" : "passed",
      assertionResults: ordered,
    }],
  };
}

const results = [];
try {
  for (const [name, files, exposeGc] of phases) {
    const selectedFiles = requestedFile ? files.filter(file => file === requestedFile) : files;
    for (const [index, file] of selectedFiles.entries()) {
      const report = join(temp, `${name}-${index}.json`);
      const outcome = invokeVitest(file, exposeGc, report);
      if (!existsSync(report)) {
        const isolatedReport = await isolateTimedOutFile(name, file, exposeGc, index);
        results.push({ name, file, report: isolatedReport, outcome, isolated: Boolean(isolatedReport) });
        continue;
      }
      results.push({ name, file, report: JSON.parse(await readFile(report, "utf8")), outcome });
    }
  }

  const totals = results.reduce(
    (sum, result) => {
      sum.files++;
      if (!result.report) {
        sum.failedFiles++;
        sum.harnessFailures++;
        return sum;
      }
      sum.tests += result.report.numTotalTests;
      sum.passed += result.report.numPassedTests;
      sum.failed += result.report.numFailedTests;
      sum.skipped += result.report.numPendingTests;
      const assertions = result.report.testResults.flatMap(file => file.assertionResults ?? []);
      if (result.report.testResults.some(file => file.status === "failed")) sum.failedFiles++;
      else if (assertions.length > 0 && assertions.every(test => test.status === "pending" || test.status === "skipped")) {
        sum.skippedFiles++;
      } else sum.passedFiles++;
      return sum;
    },
    {
      tests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      files: 0,
      passedFiles: 0,
      failedFiles: 0,
      skippedFiles: 0,
      harnessFailures: 0,
    },
  );

  console.log(`Pinned upstream: ${lock.solid.revision}`);
  console.log(`Candidate: ${relative(root, entry)} -> compiled development JS (npm delegation: none)`);
  console.log(`Tests: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped, ${totals.tests} total`);
  console.log(`Files: ${totals.passedFiles} passed, ${totals.failedFiles} failed, ${totals.skippedFiles} skipped, ${totals.files} total`);
  if (totals.harnessFailures) console.log(`Process-level failures/timeouts: ${totals.harnessFailures}`);

  let previousPhase;
  for (const result of results) {
    if (result.name !== previousPhase) {
      console.log(`\n[${result.name}]`);
      previousPhase = result.name;
    }
    if (!result.report) {
      const detail = result.outcome.error?.code === "ETIMEDOUT"
        ? "process timeout after 30s"
        : (result.outcome.stderr || result.outcome.stdout || "Vitest emitted no report").trim().split("\n")[0];
      console.log(`FAILED ${result.file} (process-level: ${detail})`);
      continue;
    }
    for (const fileResult of result.report.testResults) {
      const path = relative(testsRoot, fileResult.name).replaceAll("\\", "/");
      const assertions = fileResult.assertionResults ?? [];
      const passed = assertions.filter(test => test.status === "passed").length;
      const failed = assertions.filter(test => test.status === "failed").length;
      const skipped = assertions.filter(test => test.status === "pending" || test.status === "skipped").length;
      const status = failed > 0 || fileResult.status === "failed"
        ? "FAILED"
        : assertions.length > 0 && skipped === assertions.length
          ? "SKIPPED"
          : "PASSED";
      console.log(`${status} ${path} (${passed} passed, ${failed} failed, ${skipped} skipped)`);
      for (const assertion of verbose ? assertions.filter(test => test.status === "failed") : []) {
        const message = assertion.failureMessages?.[0]?.split("\n")[0] ?? "failed";
        console.log(`  FAIL ${assertion.fullName ?? assertion.title}: ${message}`);
      }
    }
  }

  console.log("\n[classifications]");
  for (const file of benchmarks) console.log(`BENCHMARK ${file}`);
  for (const file of typeOnly) console.log(`TYPE-ONLY ${file}`);
  for (const file of helpers) console.log(`HELPER ${file}`);
  for (const [file, reason] of incompatible) console.log(`INCOMPATIBLE ${file}: ${reason}`);
  for (const [test, reason] of partialIncompatible) console.log(`INCOMPATIBLE ${test}: ${reason}`);
  if (!verbose && totals.failed > 0) console.log("Use --verbose for individual assertion failures.");

  if (totals.failed > 0 || totals.harnessFailures > 0 || results.some(result => result.outcome.status !== 0 && result.report?.numFailedTests === 0)) {
    process.exitCode = 1;
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
