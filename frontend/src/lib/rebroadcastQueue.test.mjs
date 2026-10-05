import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const outputDir = await mkdtemp(join(tmpdir(), "rebroadcast-queue-test-"));
after(() => rm(outputDir, { recursive: true, force: true }));
const outputPath = join(outputDir, "rebroadcastQueue.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("./rebroadcastQueue.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outputPath,
});
const { splitRebroadcastPosts } = await import(outputPath);

const question = (id, dismissed, item_type = "community_post", delivery_state) => ({
  id,
  item_type,
  dismissed,
  delivery_state,
});

test("ignored community posts stay in a separate merge queue", () => {
  const result = splitRebroadcastPosts([
    question("new", false),
    question("ignored", true),
    question("merged", true, "community_post", "merged"),
    question("ordinary", false, "question"),
  ]);
  assert.deepEqual(result.pending.map((item) => item.id), ["new"]);
  assert.deepEqual(result.ignored.map((item) => item.id), ["ignored"]);
  assert.deepEqual(result.merged.map((item) => item.id), ["merged"]);
});
