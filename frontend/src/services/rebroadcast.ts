import * as api from "./api";
import type { CustomEndpoint } from "../types";
import { REBROADCAST_PROMPT } from "./rebroadcastPrompt";

const STYLE_MARKER = "\n## 用户补充的风格范例（只学表达，不作本场事实）\n";
export function writingErrorMessage(detail: string) {
  if (/402|insufficient balance|余额不足/i.test(detail)) return "AI 账户余额不足，暂时无法生成文案。补充额度后再试，已保存的原文和录音会保留。";
  if (/401|403|invalid.*key|密钥/i.test(detail)) return "AI 密钥或调用权限没有通过验证，请到“连接 AI”检查。";
  return "暂时无法生成文案，请稍后重试。已保存的原文和录音会保留。";
}

export function connectionUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请填写完整的模型服务地址，例如 https://api.deepseek.com。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("模型服务地址应以 http:// 或 https:// 开头，且不包含密码、查询参数或井号。");
  }
  if (/\/chat\/completions\/?$/.test(url.pathname)) throw new Error("请填写基础地址，去掉末尾的 /chat/completions。");
  return url.toString().replace(/\/+$/, "");
}

export function sameConnectionUrl(left: string, right: string) {
  try { return connectionUrl(left) === connectionUrl(right); } catch { return false; }
}
export function styleFromPrompt(prompt: string) {
  const index = prompt.indexOf(STYLE_MARKER);
  return index < 0 ? "" : prompt.slice(index + STYLE_MARKER.length).replace(/{{/g, "{").replace(/}}/g, "}");
}
export function promptWithStyle(style: string) {
  // The backend formats the template with Python str.format.
  return REBROADCAST_PROMPT + (style.trim() ? STYLE_MARKER + style.trim().replace(/{/g, "{{").replace(/}/g, "}}") : "");
}
export async function saveWritingProfile(style?: string, modelId?: string) {
  const agents = await api.listAgents();
  const writer = agents.find((a) => a.slug === "consolidated_analyst");
  if (!writer) throw new Error("暂时找不到文案写作设置，请重启程序后重试。");
  const selected = modelId ?? writer.model_id;
  if (!selected) throw new Error("请先在“连接 AI”中选择用于写文案的模型。");
  return api.updateAgent("consolidated_analyst", {
    model_id: selected, enabled: true, interval_seconds: 45,
    prompt: promptWithStyle(style ?? styleFromPrompt(writer?.prompt ?? "")),
    lenses: JSON.stringify([{ key: "community_post", label: "群转播文案", item_type: "community_post", enabled: true, prompt: "只按主提示词生成群转播文案；没有值得转播的新信息时，items 为空数组。" }]),
  });
}
export async function prepareRebroadcastSession(sessionId: string) {
  const agents = await api.listAgents();
  const writer = agents.find((a) => a.slug === "consolidated_analyst");
  if (writer?.model_id) await saveWritingProfile();
  // Exactly one writing task. No sales analysis, live gateway or end-call briefs.
  await api.setSessionAgents(sessionId, agents.map((a) => ({
    agent_slug: a.slug,
    enabled: a.slug === "consolidated_analyst" && Boolean(writer?.model_id),
  })));
}

export async function connectWritingModel(input: {
  endpointId?: string; name: string; baseUrl: string; apiKey: string; modelId: string;
}) {
  const baseUrl = connectionUrl(input.baseUrl);
  const modelId = input.modelId.trim();
  if (!input.name.trim() || !modelId) throw new Error("请填写连接名称和模型 ID。模型列表读不到时，也可以直接手填。");
  const endpoints = await api.listEndpoints();
  const original = endpoints.find((endpoint) => endpoint.id === input.endpointId);
  if (input.endpointId && !original) throw new Error("这条连接已不存在，请重新打开“连接 AI”后设置。");
  // A changed URL is a new connection: never forward a stored key to another service.
  const existing = original && sameConnectionUrl(original.base_url, baseUrl) ? original : undefined;
  const models = existing?.models.map(({ id, label }) => ({ id, label })) ?? [];
  if (!models.some((model) => model.id === modelId)) models.push({ id: modelId, label: modelId });
  const payload: api.EndpointPayload = {
    name: input.name.trim(), base_url: baseUrl, models, enabled: true,
    ...(input.apiKey.trim() ? { api_key: input.apiKey.trim() } : {}),
  };
  // Listing remote models is optional; saving an explicit ID must work without it.
  const endpoint: CustomEndpoint = existing
    ? await api.updateEndpoint(existing.id, payload)
    : await api.createEndpoint(payload);
  const selected = endpoint.models.find((model) => model.id === modelId);
  if (!selected) throw new Error("连接已保存，但没有找到刚填写的模型。请重新打开连接检查。");
  await saveWritingProfile(undefined, selected.model_id);
  return endpoint;
}
