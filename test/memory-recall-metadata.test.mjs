import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

const {
  registerMemoryRecallTool,
  registerMemoryForgetTool,
  registerMemoryUpdateTool,
} = jiti("../src/tools.ts");

function makeResults(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    entry: {
      id: `m${index + 1}`,
      text: `remember this ${index + 1}`,
      category: "fact",
      scope: "global",
      importance: 0.7,
    },
    score: 0.82 - index * 0.01,
    sources: {
      vector: { score: 0.82 - index * 0.01, rank: index + 1 },
      bm25: { score: 0.88 - index * 0.01, rank: index + 2 },
    },
  }));
}

function makeApiCapture() {
  let capturedCreator = null;
  const api = {
    registerTool(cb) {
      capturedCreator = cb;
    },
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  };
  return { api, getCreator: () => capturedCreator };
}

function makeContext({ expose = false, results = makeResults() } = {}) {
  return {
    retriever: {
      async retrieve() {
        return results;
      },
      getConfig() {
        return { mode: "hybrid" };
      },
    },
    store: {
      async delete() {
        return true;
      },
      async update() {
        return true;
      },
    },
    scopeManager: {
      getAccessibleScopes: () => ["global"],
      isAccessible: () => true,
      getDefaultScope: () => "global",
    },
    embedder: { embedPassage: async () => [] },
    agentId: "main",
    workspaceDir: "/tmp",
    mdMirror: null,
    exposeRetrievalMetadata: expose,
  };
}

function createTool(registerTool, context) {
  const { api, getCreator } = makeApiCapture();
  registerTool(api, context);
  const creator = getCreator();
  assert.ok(typeof creator === "function");
  return creator({});
}

describe("memory metadata exposure", () => {
  it("keeps memory_recall text clean when exposeRetrievalMetadata=false", async () => {
    const tool = createTool(
      registerMemoryRecallTool,
      makeContext({ expose: false, results: makeResults(1) }),
    );

    const res = await tool.execute(null, { query: "test" });

    assert.equal(res.details.count, 1);
    assert.ok(Array.isArray(res.details.memories));
    assert.equal(res.details.debug, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(res.details.memories[0], "score"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(res.details.memories[0], "sources"), false);
    assert.match(res.content[0].text, /remember this 1/);
    assert.doesNotMatch(res.content[0].text, /82%|vector|BM25|reranked/);
  });

  it("exposes debug metadata without polluting memory_recall text when enabled", async () => {
    const tool = createTool(
      registerMemoryRecallTool,
      makeContext({ expose: true, results: makeResults(2) }),
    );

    const res = await tool.execute(null, { query: "test" });

    assert.equal(res.details.count, 2);
    assert.ok(Array.isArray(res.details.memories));
    assert.ok(Array.isArray(res.details.debug));
    assert.equal(res.details.debug.length, res.details.memories.length);
    assert.equal(typeof res.details.debug[0].score, "number");
    assert.ok(res.details.debug[0].sources.vector);
    assert.ok(res.details.debug[0].sources.bm25);
    assert.equal(res.details.debug[0].id, res.details.memories[0].id);
    assert.equal(res.details.debug[1].id, res.details.memories[1].id);
    assert.doesNotMatch(res.content[0].text, /82%|vector|BM25|reranked/);
  });

  it("preserves details.candidates for memory_forget while attaching debug metadata separately", async () => {
    const tool = createTool(
      registerMemoryForgetTool,
      makeContext({ expose: true, results: makeResults(2) }),
    );

    const res = await tool.execute(null, { query: "test" });

    assert.equal(res.details.action, "candidates");
    assert.ok(Array.isArray(res.details.candidates));
    assert.equal(res.details.memories, undefined);
    assert.ok(Array.isArray(res.details.debug));
    assert.equal(Object.prototype.hasOwnProperty.call(res.details.candidates[0], "score"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(res.details.candidates[0], "sources"), false);
  });

  it("preserves details.candidates for memory_update while attaching debug metadata separately", async () => {
    const tool = createTool(
      registerMemoryUpdateTool,
      makeContext({ expose: true, results: makeResults(2) }),
    );

    const res = await tool.execute(null, { memoryId: "test", text: "updated text" });

    assert.equal(res.details.action, "candidates");
    assert.ok(Array.isArray(res.details.candidates));
    assert.equal(res.details.memories, undefined);
    assert.ok(Array.isArray(res.details.debug));
    assert.equal(Object.prototype.hasOwnProperty.call(res.details.candidates[0], "score"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(res.details.candidates[0], "sources"), false);
  });
});
