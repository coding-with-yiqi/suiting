import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WechatReview.tsx", import.meta.url), "utf8");

test("review window offers explicit defaults without changing this message automatically", () => {
  assert.match(source, /suiting:wechat-default-targets/);
  assert.match(source, /保存为默认群组/);
  assert.match(source, /本条文案临时增删不会改变默认设置/);
  assert.match(source, /keepAvailableSelection/);
  assert.match(source, /selectAvailableDefaults/);
});
