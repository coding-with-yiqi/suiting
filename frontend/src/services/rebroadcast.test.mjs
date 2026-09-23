import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const outputDir = await mkdtemp(join(tmpdir(), "rebroadcast-test-"));
const outputPath = join(outputDir, "bundle.cjs");
await build({ entryPoints: [fileURLToPath(new URL("./rebroadcast.ts", import.meta.url))], bundle: true, format: "cjs", platform: "node", outfile: outputPath });
const { connectWritingModel, saveWritingProfile, prepareRebroadcastSession, styleFromPrompt, promptWithStyle } = require(outputPath);
after(() => rm(outputDir, { recursive: true, force: true }));

function endpoint(id, baseUrl, ids, hasKey = true) {
  return { id, name: id, base_url: baseUrl, has_api_key: hasKey, enabled: true, models: ids.map((model) => ({ id: model, label: model, model_id: `endpoint:${id}:${model}` })) };
}

async function withApi({ endpoints = [], modelId = "", prompt = "" } = {}, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const saved = structuredClone(endpoints);
  const writer = { slug: "consolidated_analyst", model_id: modelId, prompt, enabled: true };
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method ?? "GET", body });
    let result;
    if (url === "/api/endpoints" && !options.method) result = saved;
    else if (url === "/api/agents" && !options.method) result = [writer, { slug: "sales", enabled: true }];
    else if (url === "/api/agents/consolidated_analyst") { Object.assign(writer, body); result = writer; }
    else if (url === "/api/endpoints" && options.method === "POST") {
      result = endpoint(`new-${saved.length}`, body.base_url, body.models.map((model) => model.id), Boolean(body.api_key));
      result.name = body.name; saved.push(result);
    } else if (url.startsWith("/api/endpoints/") && options.method === "PUT") {
      const current = saved.find((item) => url === `/api/endpoints/${item.id}`);
      assert.ok(current, "must only update a known endpoint");
      Object.assign(current, {
        name: body.name, base_url: body.base_url, enabled: body.enabled,
        has_api_key: body.api_key === undefined ? current.has_api_key : Boolean(body.api_key),
        models: body.models.map((model) => ({ ...model, model_id: `endpoint:${current.id}:${model.id}` })),
      });
      result = current;
    } else if (url === "/api/sessions/test-session/agents") result = body;
    else throw new Error(`Unexpected API request: ${url}`);
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  };
  try { await run({ calls, saved, writer }); } finally { globalThis.fetch = originalFetch; }
}

test("a manually entered model saves without a remote model-list request", async () => {
  await withApi({}, async ({ calls, writer }) => {
    const result = await connectWritingModel({ name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", apiKey: "example-key", modelId: "account-visible-model" });
    assert.equal(writer.model_id, `endpoint:${result.id}:account-visible-model`);
    assert.equal(calls.some((call) => /probe|\/test|\/models/.test(call.url)), false);
  });
});

test("blank key on the same endpoint preserves credentials, other models and other endpoints", async () => {
  const first = endpoint("kimi", "https://api.moonshot.cn/v1", ["old-model"]);
  const other = endpoint("deepseek", "https://api.deepseek.com", ["another-model"]);
  await withApi({ endpoints: [first, other] }, async ({ calls, saved }) => {
    await connectWritingModel({ endpointId: "kimi", name: "Kimi", baseUrl: "https://api.moonshot.cn/v1/", apiKey: "  ", modelId: "new-model" });
    const update = calls.find((call) => call.method === "PUT" && call.url === "/api/endpoints/kimi");
    assert.equal(Object.hasOwn(update.body, "api_key"), false);
    assert.equal(saved[0].has_api_key, true);
    assert.deepEqual(saved[0].models.map((model) => model.id), ["old-model", "new-model"]);
    assert.deepEqual(saved[1], other);
  });
});

test("changing an endpoint address creates a separate connection and cannot reuse its saved key", async () => {
  const original = endpoint("private", "https://original.example/v1", ["kept-model"]);
  await withApi({ endpoints: [original] }, async ({ calls, saved }) => {
    await connectWritingModel({ endpointId: "private", name: "New server", baseUrl: "https://new.example/v1", apiKey: "", modelId: "manual-model" });
    const create = calls.find((call) => call.url === "/api/endpoints" && call.method === "POST");
    assert.equal(Object.hasOwn(create.body, "api_key"), false);
    assert.equal(saved.length, 2);
    assert.deepEqual(saved[0], original);
    assert.equal(saved[1].has_api_key, false);
  });
});

test("saving another provider only sends its newly supplied key to its own endpoint", async () => {
  const original = endpoint("deepseek", "https://api.deepseek.com", ["kept-model"]);
  await withApi({ endpoints: [original] }, async ({ calls, saved }) => {
    await connectWritingModel({ name: "GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "new-provider-key", modelId: "chosen-model" });
    const keyCalls = calls.filter((call) => call.body && Object.hasOwn(call.body, "api_key"));
    assert.equal(keyCalls.length, 1);
    assert.equal(keyCalls[0].body.base_url, "https://open.bigmodel.cn/api/paas/v4");
    assert.equal(keyCalls[0].body.api_key, "new-provider-key");
    assert.deepEqual(saved[0], original);
  });
});

test("updating style preserves the selected writer including a built-in model", async () => {
  await withApi({ modelId: "selected-built-in-model" }, async ({ writer, calls }) => {
    await saveWritingProfile("提问后留悬念 {不要编造}");
    assert.equal(writer.model_id, "selected-built-in-model");
    assert.equal(styleFromPrompt(writer.prompt), "提问后留悬念 {不要编造}");
    assert.equal(calls.some((call) => call.url.includes("endpoints")), false);
  });
});

test("starting a session keeps the chosen writer and style, without switching to DeepSeek", async () => {
  await withApi({ modelId: "endpoint:kimi:chosen", prompt: promptWithStyle("保留的风格") }, async ({ calls, writer }) => {
    await prepareRebroadcastSession("test-session");
    assert.equal(writer.model_id, "endpoint:kimi:chosen");
    assert.equal(styleFromPrompt(writer.prompt), "保留的风格");
    const session = calls.find((call) => call.url === "/api/sessions/test-session/agents");
    assert.deepEqual(session.body, [
      { agent_slug: "consolidated_analyst", enabled: true },
      { agent_slug: "sales", enabled: false },
    ]);
    assert.equal(calls.some((call) => call.url.includes("endpoints")), false);
  });
});

test("a session without a selected model does not silently choose a provider", async () => {
  await withApi({}, async ({ calls }) => {
    await prepareRebroadcastSession("test-session");
    assert.equal(calls.some((call) => call.url === "/api/agents/consolidated_analyst"), false);
    assert.ok(calls.find((call) => call.url === "/api/sessions/test-session/agents").body.every((agent) => !agent.enabled));
  });
});

test("empty model and credential-bearing URL are rejected before any API mutation", async () => {
  await withApi({}, async ({ calls }) => {
    await assert.rejects(connectWritingModel({ name: "Missing model", baseUrl: "https://example.com/v1", apiKey: "", modelId: " " }), /模型 ID/);
    await assert.rejects(connectWritingModel({ name: "Unsafe URL", baseUrl: "https://user:password@example.com/v1", apiKey: "", modelId: "model" }), /密码/);
    assert.equal(calls.length, 0);
  });
});
