const root = suite("");
let currentSuite = root;
const spies = new Set();
const stubbedGlobals = new Map();
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
let fakeClock;

function suite(name, parent = null, skipped = false) {
  return { name, parent, skipped, items: [], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
}

function registerSuite(name, fn, skipped = false) {
  const child = suite(name, currentSuite, skipped || currentSuite.skipped);
  currentSuite.items.push({ kind: "suite", value: child });
  const previous = currentSuite;
  currentSuite = child;
  try {
    fn();
  } finally {
    currentSuite = previous;
  }
}

function registerTest(name, fn, skipped = false) {
  currentSuite.items.push({ kind: "test", value: { name, fn, skipped: skipped || currentSuite.skipped } });
}

export function describe(name, fn) {
  registerSuite(name, fn);
}
describe.skip = (name, fn) => registerSuite(name, fn, true);
describe.only = describe;

export function test(name, fn) {
  registerTest(name, fn);
}
test.skip = (name, fn) => registerTest(name, fn, true);
test.only = test;
export const it = test;

export const beforeAll = fn => currentSuite.beforeAll.push(fn);
export const afterAll = fn => currentSuite.afterAll.push(fn);
export const beforeEach = fn => currentSuite.beforeEach.push(fn);
export const afterEach = fn => currentSuite.afterEach.push(fn);

function format(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item instanceof Error) return { name: item.name, message: item.message };
      if (typeof item === "bigint") return `${item}n`;
      return item;
    });
  } catch {
    return String(value);
  }
}

function asymmetric(kind, value) {
  return { __corpusAsymmetric: kind, value };
}

function deepEqual(actual, expected, seen = new WeakMap()) {
  if (expected?.__corpusAsymmetric === "any") {
    if (expected.value === String) return typeof actual === "string" || actual instanceof String;
    if (expected.value === Number) return typeof actual === "number" || actual instanceof Number;
    if (expected.value === Boolean) return typeof actual === "boolean" || actual instanceof Boolean;
    return actual instanceof expected.value;
  }
  if (expected?.__corpusAsymmetric === "stringContaining") {
    return typeof actual === "string" && actual.includes(expected.value);
  }
  if (expected?.__corpusAsymmetric === "objectContaining") {
    return actual != null && Object.keys(expected.value).every(key => deepEqual(actual[key], expected.value[key], seen));
  }
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== "object" || actual === null || typeof expected !== "object" || expected === null) return false;
  if (actual instanceof Date || expected instanceof Date) {
    return actual instanceof Date && expected instanceof Date && actual.getTime() === expected.getTime();
  }
  if (actual instanceof RegExp || expected instanceof RegExp) return String(actual) === String(expected);
  if (actual instanceof Error || expected instanceof Error) {
    return actual instanceof Error && expected instanceof Error && actual.name === expected.name && actual.message === expected.message;
  }
  if (seen.get(actual) === expected) return true;
  seen.set(actual, expected);
  const actualKeys = Reflect.ownKeys(actual).filter(key => Object.prototype.propertyIsEnumerable.call(actual, key));
  const expectedKeys = Reflect.ownKeys(expected).filter(key => Object.prototype.propertyIsEnumerable.call(expected, key));
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every(key => actualKeys.includes(key) && deepEqual(actual[key], expected[key], seen));
}

function fail(message) {
  throw new Error(message);
}

function thrownBy(fn) {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

function makeMatchers(actual, negated = false) {
  const assert = (pass, message) => {
    if (negated ? pass : !pass) fail(message);
  };
  const matchers = {
    toBe(expected) {
      assert(Object.is(actual, expected), `expected ${format(actual)} ${negated ? "not " : ""}to be ${format(expected)}`);
    },
    toEqual(expected) {
      assert(deepEqual(actual, expected), `expected ${format(actual)} ${negated ? "not " : ""}to equal ${format(expected)}`);
    },
    toStrictEqual(expected) {
      return matchers.toEqual(expected);
    },
    toBeDefined() {
      assert(actual !== undefined, `expected value ${negated ? "not " : ""}to be defined`);
    },
    toBeUndefined() {
      assert(actual === undefined, `expected ${format(actual)} ${negated ? "not " : ""}to be undefined`);
    },
    toBeNull() {
      assert(actual === null, `expected ${format(actual)} ${negated ? "not " : ""}to be null`);
    },
    toBeTruthy() {
      assert(!!actual, `expected ${format(actual)} ${negated ? "not " : ""}to be truthy`);
    },
    toBeFalsy() {
      assert(!actual, `expected ${format(actual)} ${negated ? "not " : ""}to be falsy`);
    },
    toContain(expected) {
      assert(actual?.includes?.(expected), `expected ${format(actual)} ${negated ? "not " : ""}to contain ${format(expected)}`);
    },
    toHaveLength(expected) {
      assert(actual?.length === expected, `expected length ${format(actual?.length)} ${negated ? "not " : ""}to be ${expected}`);
    },
    toBeInstanceOf(expected) {
      assert(actual instanceof expected, `expected ${format(actual)} ${negated ? "not " : ""}to be an instance of ${expected?.name}`);
    },
    toMatch(expected) {
      const pass = expected instanceof RegExp ? expected.test(String(actual)) : String(actual).includes(String(expected));
      assert(pass, `expected ${format(actual)} ${negated ? "not " : ""}to match ${expected}`);
    },
    toBeGreaterThan(expected) {
      assert(actual > expected, `expected ${format(actual)} ${negated ? "not " : ""}to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      assert(actual >= expected, `expected ${format(actual)} ${negated ? "not " : ""}to be at least ${expected}`);
    },
    toBeLessThan(expected) {
      assert(actual < expected, `expected ${format(actual)} ${negated ? "not " : ""}to be less than ${expected}`);
    },
    toBeLessThanOrEqual(expected) {
      assert(actual <= expected, `expected ${format(actual)} ${negated ? "not " : ""}to be at most ${expected}`);
    },
    toThrow(expected) {
      if (typeof actual !== "function") fail("toThrow expects a function");
      const error = thrownBy(actual);
      let pass = error !== undefined;
      if (pass && expected instanceof RegExp) pass = expected.test(String(error?.message ?? error));
      else if (pass && typeof expected === "string") pass = String(error?.message ?? error).includes(expected);
      else if (pass && typeof expected === "function") pass = error instanceof expected;
      assert(pass, `expected function ${negated ? "not " : ""}to throw${expected ? ` ${expected}` : ""}`);
    },
    toHaveBeenCalled() {
      assert(!!actual?.mock?.calls?.length, `expected spy ${negated ? "not " : ""}to have been called`);
    },
    toHaveBeenCalledTimes(expected) {
      assert(actual?.mock?.calls?.length === expected, `expected spy calls ${actual?.mock?.calls?.length} ${negated ? "not " : ""}to be ${expected}`);
    },
    toHaveBeenCalledWith(...expected) {
      const pass = actual?.mock?.calls?.some(call => deepEqual(call, expected));
      assert(pass, `expected spy ${negated ? "not " : ""}to have been called with ${format(expected)}`);
    },
  };
  Object.defineProperty(matchers, "not", { get: () => makeMatchers(actual, !negated) });
  return matchers;
}

export function expect(actual) {
  return makeMatchers(actual);
}
expect.any = constructor => asymmetric("any", constructor);
expect.stringContaining = value => asymmetric("stringContaining", value);
expect.objectContaining = value => asymmetric("objectContaining", value);

function mockFunction(implementation = () => undefined) {
  let impl = implementation;
  const fn = function (...args) {
    fn.mock.calls.push(args);
    try {
      const value = impl.apply(this, args);
      fn.mock.results.push({ type: "return", value });
      return value;
    } catch (error) {
      fn.mock.results.push({ type: "throw", value: error });
      throw error;
    }
  };
  fn.mock = { calls: [], results: [] };
  fn.mockImplementation = next => (impl = next, fn);
  fn.mockReturnValue = value => (impl = () => value, fn);
  fn.mockResolvedValue = value => (impl = () => Promise.resolve(value), fn);
  fn.mockRejectedValue = value => (impl = () => Promise.reject(value), fn);
  fn.mockClear = () => (fn.mock.calls.length = 0, fn.mock.results.length = 0, fn);
  return fn;
}

function restoreAllMocks() {
  for (const spy of [...spies]) spy.mockRestore();
}

function useFakeTimers() {
  if (fakeClock) return;
  fakeClock = { now: 0, nextId: 1, tasks: new Map() };
  const schedule = (callback, delay, args, interval) => {
    const id = fakeClock.nextId++;
    fakeClock.tasks.set(id, {
      callback,
      time: fakeClock.now + Math.max(0, Number(delay) || 0),
      args,
      interval,
    });
    return id;
  };
  globalThis.setTimeout = (callback, delay, ...args) => schedule(callback, delay, args, 0);
  globalThis.setInterval = (callback, delay, ...args) => schedule(callback, delay, args, Math.max(1, Number(delay) || 0));
  globalThis.clearTimeout = globalThis.clearInterval = id => fakeClock?.tasks.delete(id);
}

function useRealTimers() {
  if (!fakeClock) return;
  fakeClock = undefined;
  globalThis.setTimeout = nativeSetTimeout;
  globalThis.clearTimeout = nativeClearTimeout;
  globalThis.setInterval = nativeSetInterval;
  globalThis.clearInterval = nativeClearInterval;
}

async function advanceTimers(target, asynchronous) {
  if (!fakeClock) return;
  while (true) {
    const next = [...fakeClock.tasks.entries()]
      .filter(([, task]) => task.time <= target)
      .sort((left, right) => left[1].time - right[1].time || left[0] - right[0])[0];
    if (!next) break;
    const [id, task] = next;
    fakeClock.tasks.delete(id);
    fakeClock.now = task.time;
    task.callback(...task.args);
    if (task.interval) {
      task.time += task.interval;
      fakeClock.tasks.set(id, task);
    }
    if (asynchronous) await Promise.resolve();
  }
  fakeClock.now = target;
}

export const vi = {
  fn: mockFunction,
  spyOn(object, property) {
    const original = object[property];
    const spy = mockFunction(function (...args) {
      return original.apply(this, args);
    });
    spy.mockRestore = () => {
      object[property] = original;
      spies.delete(spy);
    };
    object[property] = spy;
    spies.add(spy);
    return spy;
  },
  restoreAllMocks,
  clearAllMocks() {
    for (const spy of spies) spy.mockClear();
  },
  stubGlobal(name, value) {
    if (!stubbedGlobals.has(name)) stubbedGlobals.set(name, globalThis[name]);
    globalThis[name] = value;
  },
  unstubAllGlobals() {
    for (const [name, value] of stubbedGlobals) globalThis[name] = value;
    stubbedGlobals.clear();
  },
  useFakeTimers,
  useRealTimers,
  runAllTimers() {
    if (!fakeClock) return;
    const last = Math.max(fakeClock.now, ...[...fakeClock.tasks.values()].map(task => task.time));
    void advanceTimers(last, false);
  },
  async advanceTimersByTimeAsync(milliseconds) {
    await advanceTimers((fakeClock?.now ?? 0) + milliseconds, true);
  },
};

async function invoke(fn, timeoutMs) {
  const work = fn.length
    ? new Promise((resolve, reject) => fn(error => error ? reject(error) : resolve()))
    : Promise.resolve().then(fn);
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = nativeSetTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    nativeClearTimeout(timer);
  }
}

function errorRecord(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    stack: error?.stack,
  };
}

export async function runCorpusTests(options = {}) {
  const results = [];
  const skipPatterns = (options.skipTests ?? []).map(value => new RegExp(value));
  const timeoutMs = options.timeoutMs ?? 10000;

  async function runSuite(node, parents) {
    const path = node.name ? [...parents, node.name] : parents;
    const runnable = node.items.some(item => {
      if (item.kind === "suite") return true;
      const fullName = [...path, item.value.name].join(" > ");
      return !item.value.skipped && !skipPatterns.some(pattern => pattern.test(fullName));
    });
    if (runnable) for (const hook of node.beforeAll) await invoke(hook, timeoutMs);

    for (const item of node.items) {
      if (item.kind === "suite") {
        await runSuite(item.value, path);
        continue;
      }
      const entry = item.value;
      const fullName = [...path, entry.name].join(" > ");
      const explicitlySkipped = entry.skipped || skipPatterns.some(pattern => pattern.test(fullName));
      if (explicitlySkipped) {
        results.push({
          name: fullName,
          status: "skip",
          durationMs: 0,
          reason: entry.skipped ? "upstream test is marked skipped" : options.skipReason ?? "unsupported by this corpus configuration",
        });
        continue;
      }
      const lineage = [];
      for (let cursor = node; cursor; cursor = cursor.parent) lineage.unshift(cursor);
      const started = performance.now();
      let error;
      try {
        for (const owner of lineage) for (const hook of owner.beforeEach) await invoke(hook, timeoutMs);
        await invoke(entry.fn, timeoutMs);
      } catch (caught) {
        error = caught;
      } finally {
        try {
          for (const owner of [...lineage].reverse()) {
            for (const hook of owner.afterEach) await invoke(hook, timeoutMs);
          }
        } catch (caught) {
          error ??= caught;
        }
      }
      results.push({
        name: fullName,
        status: error ? "fail" : "pass",
        durationMs: Math.round(performance.now() - started),
        ...(error ? { error: errorRecord(error) } : {}),
      });
    }

    if (runnable) for (const hook of node.afterAll) await invoke(hook, timeoutMs);
  }

  try {
    await runSuite(root, []);
  } catch (error) {
    results.push({ name: "<suite hook>", status: "fail", durationMs: 0, error: errorRecord(error) });
  } finally {
    restoreAllMocks();
    vi.unstubAllGlobals();
    useRealTimers();
  }
  return results;
}
