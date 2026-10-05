import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const outputDir = await mkdtemp(join(tmpdir(), "live-questions-test-"));
after(() => rm(outputDir, { recursive: true, force: true }));
const outputPath = join(outputDir, "liveQuestions.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("./liveQuestions.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outputPath,
});
const { appendLiveQuestions } = await import(outputPath);

const data = (id, text, timestamp = "2026-10-05T12:00:00.000Z") => ({
  id,
  item_type: "community_post",
  lens_label: "",
  question: text,
  rationale: "有新事实",
  source_context: "现场原话",
  speaker_id: null,
  directive_id: null,
  timestamp,
  agent_source: "consolidated_analyst",
});

test("continuous events in one cycle keep every candidate with the newest first", () => {
  const first = appendLiveQuestions([], [data("a", "第一条")], "session-1");
  const result = appendLiveQuestions(first, [data("b", "第二条")], "session-1");
  assert.deepEqual(result.map((item) => item.id), ["b", "a"]);
  assert.deepEqual(result.map((item) => item.question), ["第二条", "第一条"]);
});

test("a replayed creation event preserves edited content and all review and answer state", () => {
  const first = {
    ...appendLiveQuestions([], [data("a", "人工改好的文案")], "session-1")[0],
    starred: true, dismissed: true, vote: 1, answered: true,
    answer_summary: "回答已记录", needs_followup: true, followup_question: "下一问",
  };
  const result = appendLiveQuestions([first], [data("a", "旧文案")], "session-1");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], first);
});
