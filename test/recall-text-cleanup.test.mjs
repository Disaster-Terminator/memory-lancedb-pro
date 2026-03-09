import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jitiFactory from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginSdkStubPath = path.resolve(testDir, "helpers", "openclaw-plugin-sdk-stub.mjs");
const jiti = jitiFactory(import.meta.url, {
  interopDefault: true,
  alias: {
    "openclaw/plugin-sdk": pluginSdkStubPath,
  },
});

const pluginModule = jiti("../index.ts");
const memoryLanceDBProPlugin = pluginModule.default || pluginModule;
const { registerMemoryRecallTool } = jiti("../src/tools.ts");
const { MemoryRetriever } = jiti("../src/retriever.ts");

function makeApiCapture() {
  let capturedCreator = null;
  const events = new Map();
  const api = {
    registerTool(cb) {
      capturedCreator = cb;
    },
    on(event, handler) {
      events.set(event, handler);
    },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  };
  return { api, getCreator: () => capturedCreator, getEvent: (name) => events.get(name) };
}

function createPluginApiHarness({ pluginConfig, resolveRoot }) {
  const eventHandlers = new Map();
  const commandHooks = new Map();
  const logs = [];

  const api = {
    pluginConfig,
    resolvePath(target) {
      if (typeof target !== "string") return target;
      if (path.isAbsolute(target)) return target;
      return path.join(resolveRoot, target);
    },
    logger: {
      info(message) {
        logs.push({ level: "info", message: String(message) });
      },
      warn(message) {
        logs.push({ level: "warn", message: String(message) });
      },
      debug(message) {
        logs.push({ level: "debug", message: String(message) });
      },
    },
    registerTool() {},
    registerCli() {},
    registerService() {},
    on(eventName, handler, meta) {
      const list = eventHandlers.get(eventName) || [];
      list.push({ handler, meta });
      eventHandlers.set(eventName, list);
    },
    registerHook(hookName, handler, meta) {
      const list = commandHooks.get(hookName) || [];
      list.push({ handler, meta });
      commandHooks.set(hookName, list);
    },
  };

  return {
    api,
    eventHandlers,
    commandHooks,
    logs,
  };
}

function makeResults() {
  return [
    {
      entry: {
        id: "m1",
        text: "remember this",
        category: "fact",
        scope: "global",
        importance: 0.7,
        timestamp: Date.now(),
      },
      score: 0.82,
      sources: {
        vector: { score: 0.82, rank: 1 },
        bm25: { score: 0.88, rank: 2 },
        reranked: { score: 0.91 },
      },
    },
  ];
}

function makeRecallContext(results = makeResults()) {
  return {
    retriever: {
      async retrieve() {
        return results;
      },
      getConfig() {
        return { mode: "hybrid" };
      },
    },
    store: {},
    scopeManager: {
      getAccessibleScopes: () => ["global"],
      isAccessible: () => true,
      getDefaultScope: () => "global",
    },
    embedder: { embedPassage: async () => [] },
    agentId: "main",
    workspaceDir: "/tmp",
    mdMirror: null,
  };
}

function createTool(registerTool, context) {
  const { api, getCreator } = makeApiCapture();
  registerTool(api, context);
  const creator = getCreator();
  assert.ok(typeof creator === "function");
  return creator({});
}

describe("recall text cleanup", () => {
  let workspaceDir;
  let originalRetrieve;

  beforeEach(() => {
    workspaceDir = mkdtempSync(path.join(tmpdir(), "recall-text-cleanup-test-"));
    originalRetrieve = MemoryRetriever.prototype.retrieve;
  });

  afterEach(() => {
    MemoryRetriever.prototype.retrieve = originalRetrieve;
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("removes retrieval metadata from memory_recall content text but preserves details fields", async () => {
    const tool = createTool(registerMemoryRecallTool, makeRecallContext());
    const res = await tool.execute(null, { query: "test" });

    assert.match(res.content[0].text, /remember this/);
    assert.doesNotMatch(res.content[0].text, /\(\d+%[^)]*\)/);
    assert.equal(typeof res.details.memories[0].score, "number");
    assert.ok(res.details.memories[0].sources.vector);
    assert.ok(res.details.memories[0].sources.bm25);
    assert.ok(res.details.memories[0].sources.reranked);
  });

  it("removes retrieval metadata from auto-recall injected text", async () => {
    MemoryRetriever.prototype.retrieve = async () => makeResults();

    const harness = createPluginApiHarness({
      resolveRoot: workspaceDir,
      pluginConfig: {
        dbPath: path.join(workspaceDir, "db"),
        embedding: { apiKey: "test-api-key" },
        autoCapture: false,
        autoRecall: true,
        autoRecallTopK: 1,
        autoRecallMinLength: 1,
        selfImprovement: { enabled: false, beforeResetNote: false, ensureLearningFiles: false },
      },
    });

    memoryLanceDBProPlugin.register(harness.api);

    const hooks = harness.eventHandlers.get("before_agent_start") || [];
    assert.equal(hooks.length, 1);

    const output = await hooks[0].handler(
      { prompt: "Please recall what I mentioned before about this task." },
      { sessionId: "auto-clean", sessionKey: "agent:main:session:auto-clean", agentId: "main" }
    );

    assert.ok(output);
    assert.match(output.prependContext, /remember this/);
    assert.doesNotMatch(output.prependContext, /\(\d+%[^)]*\)/);
  });
});
