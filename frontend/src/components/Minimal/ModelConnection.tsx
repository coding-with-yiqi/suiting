import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { CustomEndpoint, ModelInfo } from "../../types";
import * as api from "../../services/api";
import { connectWritingModel, connectionUrl, sameConnectionUrl, saveWritingProfile } from "../../services/rebroadcast";

const providers = [
  { id: "deepseek", name: "DeepSeek", url: "https://api.deepseek.com", docs: "https://api-docs.deepseek.com/", note: "使用 DeepSeek 开放平台的密钥和模型 ID。" },
  { id: "kimi", name: "Kimi / Moonshot", url: "https://api.moonshot.cn/v1", docs: "https://platform.kimi.com/docs/get-api-key", note: "中国区使用此地址；国际区可改为 https://api.moonshot.ai/v1。" },
  { id: "glm", name: "智谱 GLM", url: "https://open.bigmodel.cn/api/paas/v4", docs: "https://docs.bigmodel.cn/cn/guide/develop/openai/introduction", note: "这里使用普通 API。模型列表读不到时，从控制台复制模型 ID。" },
  { id: "qwen", name: "通义千问 / 百炼", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", docs: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope", note: "默认北京地域。可粘贴控制台的业务空间专属地址，密钥必须与地址同地域；模型 ID 可直接手填。" },
  { id: "doubao", name: "豆包 / 火山方舟", url: "https://ark.cn-beijing.volces.com/api/v3", docs: "https://docs.volcengine.com/docs/82379/1330626?lang=zh", note: "从方舟控制台复制模型 ID 或推理接入点 ID；具体型号的输出格式需要试写确认。" },
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1", docs: "https://developers.openai.com/api/docs/models", note: "选择支持聊天和 JSON 输出的文字模型，使用开发者平台的 API Key。" },
  { id: "gemini", name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", docs: "https://ai.google.dev/gemini-api/docs/openai", note: "使用 Gemini API 密钥。此入口使用 Google 的 OpenAI 兼容接口。" },
  { id: "claude", name: "Claude（实验性兼容）", url: "https://api.anthropic.com/v1", docs: "https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk", note: "Claude 兼容接口不会强制遵守 JSON 格式设置。保存后需实际试写，格式校验失败时无法生成候选文案。" },
  { id: "ollama", name: "本地 Ollama", url: "http://localhost:11434/v1", docs: "https://docs.ollama.com/api/openai-compatibility", note: "先在本机安装 Ollama 并下载模型，填写 ollama list 中的完整名称。本机默认服务可不填密钥。" },
  { id: "custom", name: "自定义兼容服务", url: "", docs: "", note: "填写支持 OpenAI Chat Completions 的服务地址和文字模型 ID；是否需要密钥以服务商说明为准。" },
] as const;
type ProviderId = typeof providers[number]["id"];
const selectStyle: CSSProperties = { width: "100%", font: "inherit", padding: "14px 16px", margin: "8px 0 18px", border: "1px solid #cbd8c9", borderRadius: 12, background: "#fcfdfb", color: "inherit" };

function providerFor(endpoint: CustomEndpoint): ProviderId {
  let hostname = "";
  try { hostname = new URL(endpoint.base_url).hostname; } catch { return "custom"; }
  if (hostname === "api.moonshot.ai") return "kimi";
  if (hostname.endsWith(".maas.aliyuncs.com") || hostname.includes("dashscope")) return "qwen";
  return providers.find((provider) => provider.url && new URL(provider.url).hostname === hostname)?.id ?? "custom";
}

export function ModelConnection({ active }: { active: boolean }) {
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [writerId, setWriterId] = useState("");
  const [selectedWriter, setSelectedWriter] = useState("");
  const [providerId, setProviderId] = useState<ProviderId>("deepseek");
  const [endpointId, setEndpointId] = useState("");
  const [name, setName] = useState("DeepSeek");
  const [baseUrl, setBaseUrl] = useState<string>(providers[0].url);
  const [key, setKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [listMessage, setListMessage] = useState("");

  const provider = providers.find((item) => item.id === providerId)!;
  const original = endpoints.find((item) => item.id === endpointId);
  const existing = original && sameConnectionUrl(original.base_url, baseUrl) ? original : undefined;
  const requiresKey = providerId !== "ollama" && providerId !== "custom";
  const canSave = Boolean(name.trim() && baseUrl.trim() && modelId.trim() && (!requiresKey || key.trim() || existing?.has_api_key));
  const locked = loading || busy || active;
  const textModels = models.filter((model) => model.supports_text);
  const currentWriter = models.find((model) => model.id === writerId);
  const selected = textModels.find((model) => model.id === selectedWriter);

  function editEndpoint(endpoint: CustomEndpoint, currentModel = "") {
    setProviderId(providerFor(endpoint)); setEndpointId(endpoint.id); setName(endpoint.name);
    setBaseUrl(endpoint.base_url); setKey("");
    setModelId(endpoint.models.find((model) => model.model_id === currentModel)?.id ?? endpoint.models[0]?.id ?? "");
    setSuggestions(endpoint.models.map((model) => model.id)); setListMessage(""); setMessage("");
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listEndpoints(), api.listAgents(), api.listModels().catch(() => null)]).then(([saved, agents, available]) => {
      if (cancelled) return;
      const currentId = agents.find((agent) => agent.slug === "consolidated_analyst")?.model_id ?? "";
      setEndpoints(saved); setModels(available ?? []); setWriterId(currentId); setSelectedWriter(currentId);
      const currentEndpoint = saved.find((endpoint) => endpoint.models.some((model) => model.model_id === currentId));
      if (currentEndpoint) editEndpoint(currentEndpoint, currentId);
      if (available === null) setMessage("暂时没能读取已登记的模型。仍可以在下面填写模型 ID 并保存连接。");
    }).catch(() => { if (!cancelled) setMessage("暂时连接不到本机程序，请确认它已打开后重新进入此页。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function chooseProvider(id: ProviderId) {
    const next = providers.find((item) => item.id === id)!;
    setProviderId(id); setEndpointId(""); setName(next.name); setBaseUrl(next.url);
    setKey(""); setModelId(""); setSuggestions([]); setMessage(""); setListMessage("");
  }

  async function readModels() {
    setBusy(true); setListMessage("");
    try {
      const url = connectionUrl(baseUrl);
      const result = existing && !key.trim()
        ? await api.testEndpoint(existing.id)
        : await api.probeEndpoint(url, key.trim());
      if (!result.ok) {
        setListMessage("没有读取到远端模型列表。这不一定表示无法使用；请从服务商控制台复制模型 ID，再保存。");
        return;
      }
      setSuggestions(result.served_models);
      setListMessage(result.served_models.length
        ? `读取到 ${result.served_models.length} 个模型。在下面输入框选择或手填文字模型 ID；这一步还没有试写文案。`
        : "服务没有返回模型列表，可以手填模型 ID。这个检查不验证余额或文案生成效果。");
    } catch {
      setListMessage("暂时读不到模型列表，可以继续手填模型 ID 并保存。请核对服务地址和密钥。");
    } finally { setBusy(false); }
  }

  async function refreshModels() {
    try { setModels(await api.listModels()); } catch { /* The saved model can still be used without refreshing this list. */ }
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const endpoint = await connectWritingModel({ endpointId: endpointId || undefined, name, baseUrl, apiKey: key, modelId });
      const savedModel = endpoint.models.find((model) => model.id === modelId.trim())!;
      setEndpoints((saved) => [...saved.filter((item) => item.id !== endpoint.id), endpoint]);
      editEndpoint(endpoint, savedModel.model_id); setWriterId(savedModel.model_id); setSelectedWriter(savedModel.model_id);
      setMessage(`已保存，群文案将使用 ${endpoint.name} · ${savedModel.id}。尚未试写，请在使用前确认可正常生成。`);
      await refreshModels();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "保存失败，请重试。";
      setMessage(key ? detail.split(key).join("（密钥已隐藏）") : detail);
    } finally { setBusy(false); }
  }

  async function selectWriter() {
    setBusy(true); setMessage("");
    try {
      await saveWritingProfile(undefined, selectedWriter); setWriterId(selectedWriter);
      setMessage("已切换写作模型。新建一场和修改文案范例都会保留这个选择。");
    } catch { setMessage("模型切换未完成，请确认本机程序仍在运行后重试。"); }
    finally { setBusy(false); }
  }

  return <>
    <section className="mr-card"><span className="mr-eyebrow">由你选择写作的 AI</span><h2>连接自己的模型。</h2>
      <p>当前写作模型：<strong>{currentWriter ? `${currentWriter.provider} · ${currentWriter.name}` : writerId || "还没有选择"}</strong></p>
      <p className="mr-note">云模型会收到用于写文案的转写文字。API 按服务商规则计费；网页会员、CLI 套餐不等于 API 免费。</p>
      {active && <p className="mr-alert" role="status">本场结束后再切换模型，当前录音继续使用已保存的设置。</p>}
      {textModels.length > 0 && <><label htmlFor="mr-writer">使用已登记的文字模型</label>
        <select id="mr-writer" style={selectStyle} value={selectedWriter} disabled={locked} onChange={(event) => setSelectedWriter(event.target.value)}>
          <option value="">请选择文字模型</option>
          {selectedWriter && !textModels.some((model) => model.id === selectedWriter) && <option value={selectedWriter}>当前模型暂未出现在列表中</option>}
          {textModels.map((model) => <option key={model.id} value={model.id} disabled={model.key_available === false}>{model.provider} · {model.name}{model.key_available === false ? "（尚未配置密钥）" : ""}</option>)}
        </select><button disabled={locked || !selected || selected.key_available === false || selectedWriter === writerId} onClick={selectWriter}>用这个模型写文案</button></>}
      <p role="status" style={{ overflowWrap: "anywhere" }}>{message}</p>
    </section>
    <section className="mr-card"><span className="mr-eyebrow">新增或修改连接</span><h2>填好三项，就能保存。</h2>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {endpoints.length > 0 && <><label htmlFor="mr-saved-connection">修改已保存的连接</label>
          <select id="mr-saved-connection" style={selectStyle} value={endpointId} onChange={(event) => {
            const endpoint = endpoints.find((item) => item.id === event.target.value);
            if (endpoint) editEndpoint(endpoint, writerId); else chooseProvider(providerId);
          }}><option value="">新增连接</option>{endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name} · {endpoint.base_url}</option>)}</select></>}
        <label htmlFor="mr-provider">选择服务商</label><select id="mr-provider" style={selectStyle} value={providerId} onChange={(event) => chooseProvider(event.target.value as ProviderId)}>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <p className={providerId === "claude" ? "mr-alert" : "mr-note"}>{provider.note} {provider.docs && <a href={provider.docs} target="_blank" rel="noreferrer">查看官方说明 ↗</a>}</p>
        <label htmlFor="mr-connection-name">给这条连接起个名字</label><input id="mr-connection-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的 Kimi" />
        <label htmlFor="mr-base-url">1. 模型服务地址</label><input id="mr-base-url" type="url" autoComplete="off" spellCheck={false} value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setKey(""); setSuggestions([]); setListMessage(""); }} placeholder="粘贴服务商提供的基础地址" />
        {original && !existing && <p className="mr-note">地址已更改，将另存为新连接。原连接保留；请重新填写新地址对应的密钥。</p>}
        <label htmlFor="mr-key">2. API 密钥{requiresKey ? "" : "（如服务需要）"}</label><input id="mr-key" type="password" autoComplete="off" value={key} placeholder={existing?.has_api_key ? "已有密钥，留空保留" : "粘贴此服务的 API Key"} onChange={(event) => setKey(event.target.value)} />
        <label htmlFor="mr-model-id">3. 文字模型 ID</label><input id="mr-model-id" list="mr-model-suggestions" autoComplete="off" spellCheck={false} value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="从控制台复制，也可以先读取列表" />
        <datalist id="mr-model-suggestions">{suggestions.map((id) => <option key={id} value={id} />)}</datalist>
        <p className="mr-note">模型列表读取失败也能手填保存。请选支持文字与 JSON 输出的模型；保存配置不代表真实调用已经通过。</p>
        <div className="mr-actions"><button disabled={!baseUrl.trim() || (requiresKey && !key.trim() && !existing?.has_api_key)} onClick={readModels}>读取模型列表（可选）</button><button className="mr-primary" disabled={!canSave} onClick={save}>{busy ? "正在处理…" : "保存并用于群文案"}</button></div>
        <p role="status" className="mr-note">{listMessage}</p>
      </fieldset>
    </section>
  </>;
}
