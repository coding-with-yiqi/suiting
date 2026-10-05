import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./MinimalWorkspace.tsx", import.meta.url), "utf8");

test("each community post exposes send and merge-ignore actions", () => {
  assert.match(source, /发送/);
  assert.match(source, /忽略并合并/);
  assert.match(source, /已忽略 · 等待并入下一条文案/);
  assert.match(source, /splitRebroadcastPosts/);
});
