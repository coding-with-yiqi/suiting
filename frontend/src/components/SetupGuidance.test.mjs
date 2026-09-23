import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

test("first-run guidance explains explicit selection without demanding Gemini", () => {
  const copy = read("./WelcomeView.tsx") + read("./ProviderOnboardingCard.tsx");

  assert.doesNotMatch(copy, /free Google \(Gemini\) key covers/i);
  assert.doesNotMatch(copy, /one of these and you are done/i);
  assert.match(copy, /电脑本地的语音转文字/);
  assert.match(copy, /推荐/);
  assert.match(copy, /不会改变你已经选择的模型/);
});
