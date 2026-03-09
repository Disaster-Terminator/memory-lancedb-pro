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

const { registerMemoryRecallTool } = jiti("../src/tools.ts");

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

function makeResults() {
  return [
    {
      entry: {
        id: "m1",
        text: "remember this",
        category: "fact",
        scope: "global",
        importance: 0.7,
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
  it("removes retrieval metadata from memory_recall content text but preserves details fields", async () => {
    const tool = createTool(registerMemoryRecallTool, makeRecallContext());
    const res = await tool.execute(null, { query: "test" });

    assert.match(res.content[0].text, /remember this/);
    assert.doesNotMatch(res.content[0].text, /82%|vector|BM25|reranked/);
    assert.equal(typeof res.details.memories[0].score, "number");
    assert.ok(res.details.memories[0].sources.vector);
    assert.ok(res.details.memories[0].sources.bm25);
  });
});
