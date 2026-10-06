import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const outputDir = await mkdtemp(join(tmpdir(), "wechat-targets-test-"));
after(() => rm(outputDir, { recursive: true, force: true }));
const outputPath = join(outputDir, "wechatTargets.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("./wechatTargets.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outputPath,
});
const { keepAvailableSelection, parseDefaultTargetIds, selectAvailableDefaults } = await import(outputPath);

const targets = [{ id: "g1", name: "直播群" }, { id: "g2", name: "课程群" }];

test("malformed or duplicate defaults are ignored", () => {
  assert.deepEqual(parseDefaultTargetIds("not json"), []);
  assert.deepEqual(parseDefaultTargetIds('["g1", "g1", 3, "  ", "g2"]'), ["g1", "g2"]);
});

test("defaults only select groups still returned by GeWe", () => {
  assert.deepEqual(selectAvailableDefaults(["g2", "gone", "g1"], targets), ["g2", "g1"]);
});

test("refresh keeps this message's temporary selection", () => {
  assert.deepEqual(keepAvailableSelection(["g1", "temporary-gone"], targets), ["g1"]);
});
