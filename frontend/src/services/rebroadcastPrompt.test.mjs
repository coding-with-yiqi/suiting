import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const outputDir = await mkdtemp(join(tmpdir(), "rebroadcast-prompt-test-"));
const outputPath = join(outputDir, "prompt.cjs");
await build({
  entryPoints: [fileURLToPath(new URL("./rebroadcastPrompt.ts", import.meta.url))],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: outputPath,
});
const { REBROADCAST_PROMPT } = require(outputPath);
after(() => rm(outputDir, { recursive: true, force: true }));

test("the live prompt allows a small stream of independent candidates", () => {
  assert.match(REBROADCAST_PROMPT, /每轮最多写 3 条/);
  assert.match(REBROADCAST_PROMPT, /本轮候选之间也不能重复/);
  assert.match(REBROADCAST_PROMPT, /items 最多三项/);
  assert.doesNotMatch(REBROADCAST_PROMPT, /每轮最多写一条/);
});

test("the live prompt keeps the evidence and existing-copy gates", () => {
  assert.match(REBROADCAST_PROMPT, /先逐条和“本场已有文案与已记录内容”比对/);
  assert.match(REBROADCAST_PROMPT, /姓名、数字、时态和入口对吗/);
  assert.match(REBROADCAST_PROMPT, /没有合格的新信息就返回空 items/);
});

test("the multi-item example is escaped for Python formatting and parses as two complete posts", () => {
  const section = REBROADCAST_PROMPT.split("示例 7｜同一轮有两个新点\n")[1].split("\n## 事实、身份与入口")[0];
  const [input, output] = section.split("完整输出：\n");
  const encoded = output.split("\n写法：")[0];
  assert.doesNotMatch(encoded.replace(/\{\{|\}\}/g, ""), /[{}]/, "all literal braces must be doubled for Python str.format");
  const { items } = JSON.parse(encoded.replace(/\{\{/g, "{").replace(/\}\}/g, "}"));
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map((item) => item.source_context)).size, 2);
  for (const item of items) {
    assert.equal(item.item_type, "community_post");
    assert.equal(item.lens, "community_post");
    assert.equal(item.speaker_id, null);
    assert.ok(item.rationale.trim());
    assert.ok(item.question.includes("\n\n"), "each post has its own complete paragraphs");
    assert.ok(input.includes(item.source_context), "each evidence excerpt comes verbatim from the sample input");
  }
});
