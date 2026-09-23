import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useConfirm } from "./ConfirmProvider";
import * as api from "../services/api";
import type { CustomEndpoint } from "../types";

// 常见服务的快捷入口。选中后会填好服务地址；点击“连接并列出模型”就会
// 从服务商读取当前可用的模型，避免把可能过期的模型名称硬编码在这里。
const PRESETS = [
  { key: "lmstudio", name: "LM Studio", base_url: "http://localhost:1234/v1", model: "" },
  { key: "ollama", name: "Ollama", base_url: "http://localhost:11434/v1", model: "" },
  { key: "vllm", name: "vLLM", base_url: "http://localhost:8000/v1", model: "" },
  { key: "litellm", name: "LiteLLM", base_url: "http://localhost:4000", model: "" },
  // 这三个服务都提供兼容 OpenAI 的聊天接口。它们的模型目录会变化，
  // 因此每次都从服务商读取模型列表。
  { key: "deepseek", name: "DeepSeek", base_url: "https://api.deepseek.com", model: "deepseek-flash" },
  { key: "kimi", name: "Kimi（月之暗面）", base_url: "https://api.moonshot.cn/v1", model: "kimi-k3" },
  { key: "glm", name: "智谱 GLM", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.5" },
];

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i;

interface FormState {
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Undefined until the user edits it, so an edit keeps the stored key. */
  keyTouched: boolean;
  models: string[];
}

const EMPTY_FORM: FormState = { name: "", baseUrl: "", apiKey: "", keyTouched: false, models: [] };

function StatusDot({ endpoint }: { endpoint: CustomEndpoint }) {
  const color =
    endpoint.last_status === "ok" ? "#72d54a" : endpoint.last_status === "error" ? "#e5484d" : "#c9cdd3";
  const label =
    endpoint.last_status === "ok" ? "可访问" : endpoint.last_status === "error" ? "无法访问" : "未测试";
  return (
    <span className="inline-flex items-center gap-1.5" title={endpoint.last_error || label}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-body text-[11px] text-brand-gray">{label}</span>
    </span>
  );
}

function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "teal" }) {
  const styles =
    tone === "teal"
      ? "bg-brand-teal/10 text-brand-teal ring-1 ring-brand-teal/30"
      : "bg-brand-light-gray-1/70 text-brand-dark-gray";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${styles}`}>{children}</span>;
}

/** 添加或编辑一个模型服务：先填地址，再选择它提供的模型。 */
function EndpointForm({
  initial,
  editing,
  onCancel,
  onSaved,
}: {
  initial: FormState;
  editing: CustomEndpoint | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { confirm } = useConfirm();
  const [form, setForm] = useState<FormState>(initial);
  const [served, setServed] = useState<string[] | null>(null);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState<"probe" | "save" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const applyPreset = (preset: (typeof PRESETS)[number]) =>
    set({
      name: form.name.trim() || preset.name,
      baseUrl: preset.base_url,
      models: form.models.length || !preset.model ? form.models : [preset.model],
    });

  const toggleModel = (name: string) =>
    set({
      models: form.models.includes(name)
        ? form.models.filter((m) => m !== name)
        : [...form.models, name],
    });

  const addManual = () => {
    const name = manual.trim();
    if (!name || form.models.includes(name)) return;
    set({ models: [...form.models, name] });
    setManual("");
  };

  // Servers that host a handful of models are almost always meant to be used
  // whole; past that, picking for the user would be presumptuous.
  const AUTO_SELECT_LIMIT = 5;

  const connect = async () => {
    setBusy("probe");
    setMessage(null);
    try {
      // Re-testing a saved endpoint at its saved address goes through the
      // stored key, so an authenticated proxy does not need it retyped.
      const reuseStored = editing && !form.keyTouched && form.baseUrl.trim() === editing.base_url;
      const result = reuseStored
        ? await api.testEndpoint(editing.id)
        : await api.probeEndpoint(form.baseUrl, form.keyTouched ? form.apiKey : "");
      setServed(result.served_models);
      setMessage({ ok: result.ok, text: result.message });
      if (
        result.ok &&
        !form.models.length &&
        result.served_models.length &&
        result.served_models.length <= AUTO_SELECT_LIMIT
      ) {
        set({ models: result.served_models });
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "连接失败" });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setMessage(null);
    const payload: api.EndpointPayload = {
      name: form.name.trim(),
      base_url: form.baseUrl.trim(),
      models: form.models.map((id) => ({ id })),
    };
    if (form.keyTouched) payload.api_key = form.apiKey;
    try {
      if (editing) {
        try {
          await api.updateEndpoint(editing.id, payload);
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes("confirm_off_prem=true")) {
            throw err;
          }
          const approved = await confirm({
            title: "要把模型服务移出本机吗？",
            message: `要把 ${editing.name} 从 ${editing.base_url} 改成 ${payload.base_url} 吗？使用这个服务时，会议内容可能离开这台电脑或你的网络。`,
            confirmLabel: "移出本机",
            tone: "danger",
          });
          if (!approved) return;
          await api.updateEndpoint(editing.id, { ...payload, confirm_off_prem: true });
        }
      } else {
        await api.createEndpoint(payload);
      }
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setBusy(null);
    }
  };

  // Inside Docker, localhost is the container, not the machine running the model.
  const dockerHint = message?.ok === false && LOOPBACK.test(form.baseUrl.trim());
  const canSave = form.name.trim() && form.baseUrl.trim() && form.models.length > 0;

  return (
    <div className="rounded-lg border border-brand-teal/30 bg-brand-light-gray-2/40 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h4 className="font-display text-sm font-bold text-brand-dark-gray">
          {editing ? `编辑 ${editing.name}` : "添加模型服务"}
        </h4>
        {!editing && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-body text-[10px] text-brand-mid-gray">快速选择服务</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                onClick={() => applyPreset(preset)}
                className="rounded-full border border-brand-light-gray-1 bg-surface px-2.5 py-0.5 font-body text-[11px] text-brand-gray transition-colors hover:border-brand-teal hover:text-brand-teal"
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block font-body text-[10px] font-medium uppercase tracking-wide text-brand-mid-gray">
            名称
          </label>
          <input
            type="text"
            value={form.name}
            placeholder="例如：我的电脑"
            onChange={(e) => set({ name: e.target.value })}
            className="w-full rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 font-body text-sm text-brand-dark-gray focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block font-body text-[10px] font-medium uppercase tracking-wide text-brand-mid-gray">
            服务地址
          </label>
          <input
            type="text"
            value={form.baseUrl}
            placeholder="http://localhost:1234/v1"
            onChange={(e) => set({ baseUrl: e.target.value })}
            className="w-full rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 font-mono text-xs text-brand-dark-gray focus:border-brand-teal focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block font-body text-[10px] font-medium uppercase tracking-wide text-brand-mid-gray">
            API 密钥 {editing?.has_api_key ? "（已保存）" : "（本地服务可不填）"}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={form.apiKey}
            placeholder={editing?.has_api_key ? "替换已保存的密钥……" : "云端服务请粘贴密钥"}
            onChange={(e) => set({ apiKey: e.target.value, keyTouched: true })}
            className="w-full rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 font-mono text-xs text-brand-dark-gray focus:border-brand-teal focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={connect}
          disabled={!form.baseUrl.trim() || busy !== null}
          className="rounded border border-brand-teal px-3 py-1.5 font-body text-xs font-medium text-brand-teal transition-opacity hover:bg-brand-teal/5 disabled:opacity-40"
        >
          {busy === "probe" ? "连接中……" : "连接并列出模型"}
        </button>
        {message && (
          <span className={`font-body text-xs ${message.ok ? "text-brand-teal" : "text-red-600"}`}>{message.text}</span>
        )}
      </div>

      {dockerHint && (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[11px] leading-relaxed text-amber-900">
          如果 随听 是在 Docker 里运行的，容器里的 <code className="font-mono">localhost</code> 指的是容器自己。
          如果模型服务在这台电脑上，请使用 <code className="font-mono">http://host.docker.internal:</code>
          {form.baseUrl.split(":")[2] || "1234"}
          <code className="font-mono">/v1</code>。
        </p>
      )}

      <div className="mt-4">
        <p className="mb-1.5 font-body text-[10px] font-medium uppercase tracking-wide text-brand-mid-gray">
          要提供给分析助手的模型{form.models.length ? `（已选 ${form.models.length} 个）` : ""}
        </p>
        {served !== null && served.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {served.map((name) => {
              const on = form.models.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => toggleModel(name)}
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    on
                      ? "bg-brand-teal text-white"
                      : "border border-brand-light-gray-1 bg-surface text-brand-gray hover:border-brand-teal"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {name}
                </button>
              );
            })}
          </div>
        )}
        {/* Models chosen by hand: some servers do not list them, and others
            name them differently from what the chat endpoint expects. */}
        {form.models.filter((m) => !(served || []).includes(m)).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {form.models
              .filter((m) => !(served || []).includes(m))
              .map((name) => (
                <button
                  key={name}
                  onClick={() => toggleModel(name)}
                  title="删除"
                  className="rounded-full bg-brand-teal px-2.5 py-1 font-mono text-[11px] text-white"
                >
                  {name} &times;
                </button>
              ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={manual}
            placeholder="也可以手动输入模型名称，例如 antares-1b"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
            className="w-full max-w-xs rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 font-mono text-xs text-brand-dark-gray focus:border-brand-teal focus:outline-none"
          />
          <button
            onClick={addManual}
            disabled={!manual.trim()}
            className="rounded border border-brand-light-gray-1 px-3 py-1.5 font-body text-xs text-brand-dark-gray transition-colors hover:border-brand-teal hover:text-brand-teal disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-brand-light-gray-1 pt-3">
        <button
          onClick={save}
          disabled={!canSave || busy !== null}
          className="rounded bg-brand-teal px-3 py-1.5 font-body text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy === "save" ? "保存中……" : editing ? "保存修改" : "添加模型服务"}
        </button>
        <button
          onClick={onCancel}
          className="rounded px-3 py-1.5 font-body text-xs text-brand-mid-gray transition-colors hover:text-brand-dark-gray"
        >
          取消
        </button>
        {!canSave && (
          <span className="font-body text-[11px] text-brand-mid-gray">
            请填写名称、服务地址，并至少添加一个模型。
          </span>
        )}
      </div>
    </div>
  );
}

interface EndpointsCardProps {
  /** Fired after any change that adds, removes, or renames selectable models. */
  onChanged?: () => void;
}

export default function EndpointsCard({ onChanged }: EndpointsCardProps) {
  const { confirm, toast } = useConfirm();
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setEndpoints(await api.listEndpoints());
    } catch (err) {
      console.error("Failed to load endpoints", err);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const afterChange = async () => {
    setEditingId(null);
    await load();
    onChanged?.();
  };

  const test = async (endpoint: CustomEndpoint) => {
    setBusyId(endpoint.id);
    try {
      const result = await api.testEndpoint(endpoint.id);
      setResults((prev) => ({ ...prev, [endpoint.id]: result.message }));
      await load();
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [endpoint.id]: err instanceof Error ? err.message : "测试失败",
      }));
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (endpoint: CustomEndpoint) => {
    setBusyId(endpoint.id);
    try {
      await api.updateEndpoint(endpoint.id, { enabled: !endpoint.enabled });
      await afterChange();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (endpoint: CustomEndpoint) => {
    const ok = await confirm({
      title: "删除模型服务",
      message: `要删除 ${endpoint.name} 吗？正在使用它的 ${endpoint.models.length} 个模型的分析助手，需要改用其他模型后才能继续运行。`,
      confirmLabel: "删除模型服务",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(endpoint.id);
    try {
      await api.deleteEndpoint(endpoint.id);
      toast(`已删除 ${endpoint.name}`);
      await afterChange();
    } finally {
      setBusyId(null);
    }
  };

  const formInitial = (endpoint: CustomEndpoint | null): FormState =>
    endpoint
      ? {
          name: endpoint.name,
          baseUrl: endpoint.base_url,
          apiKey: "",
          keyTouched: false,
          models: endpoint.models.map((m) => m.id),
        }
      : EMPTY_FORM;

  const editing = endpoints.find((e) => e.id === editingId) ?? null;

  return (
    <div className="rounded-xl bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-brand-dark-gray">更多模型服务</h3>
            <span className="inline-flex rounded-full border border-slate-500 bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-50">
              本机、局域网或云端
            </span>
          </div>
          <p className="mt-1 max-w-2xl font-body text-xs leading-relaxed text-brand-gray">
            让 随听 连接更多兼容 OpenAI 的模型服务。可以接你电脑或局域网里的 LM Studio、Ollama、vLLM，
            也可以直接接入 DeepSeek、Kimi、智谱 GLM 等国产模型。连接后，这些模型会出现在所有模型选择框中。
          </p>
        </div>
        {editingId !== "new" && (
          <button
            onClick={() => setEditingId("new")}
            className="shrink-0 rounded bg-brand-teal px-3 py-1.5 font-body text-xs font-medium text-white"
          >
            添加模型服务
          </button>
        )}
      </div>

      <div className="space-y-3">
        {endpoints.map((endpoint) => {
          const isBusy = busyId === endpoint.id;
          if (editingId === endpoint.id) {
            return (
              <EndpointForm
                key={endpoint.id}
                initial={formInitial(endpoint)}
                editing={endpoint}
                onCancel={() => setEditingId(null)}
                onSaved={afterChange}
              />
            );
          }
          return (
            <div
              key={endpoint.id}
              className={`rounded-lg border border-brand-light-gray-1 bg-brand-light-gray-2/30 p-4 transition-opacity ${
                isBusy || !endpoint.enabled ? "opacity-70" : ""
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-display text-sm font-bold text-brand-dark-gray">{endpoint.name}</span>
                  <StatusDot endpoint={endpoint} />
                  <Pill tone={endpoint.on_prem ? "teal" : "neutral"}>
                    {endpoint.on_prem ? "在你的网络内" : "远程服务"}
                  </Pill>
                  {endpoint.has_api_key && <Pill>已设置密钥</Pill>}
                  {!endpoint.enabled && <Pill>已停用</Pill>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void test(endpoint)}
                    disabled={isBusy}
                    className="rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1 font-body text-[11px] text-brand-dark-gray transition-colors hover:border-brand-teal hover:text-brand-teal disabled:opacity-40"
                  >
                    {isBusy ? "测试中……" : "测试"}
                  </button>
                  <button
                    onClick={() => setEditingId(endpoint.id)}
                    className="rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1 font-body text-[11px] text-brand-dark-gray transition-colors hover:border-brand-teal hover:text-brand-teal"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => void toggleEnabled(endpoint)}
                    disabled={isBusy}
                    className="rounded px-2.5 py-1 font-body text-[11px] text-brand-mid-gray transition-colors hover:text-brand-dark-gray disabled:opacity-40"
                  >
                    {endpoint.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    onClick={() => void remove(endpoint)}
                    disabled={isBusy}
                    className="rounded px-2.5 py-1 font-body text-[11px] text-brand-mid-gray transition-colors hover:text-red-600 disabled:opacity-40"
                  >
                    删除
                  </button>
                </div>
              </div>
              <p className="mt-1.5 truncate font-mono text-[11px] text-brand-mid-gray" title={endpoint.base_url}>
                {endpoint.base_url}
              </p>
              <p className="mt-1 font-body text-[10px] text-brand-mid-gray">
                服务编号： <code className="font-mono">{endpoint.id}</code>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {endpoint.models.map((model) => (
                  <span
                    key={model.model_id}
                    title={model.model_id}
                    className="inline-flex rounded-full bg-surface px-2.5 py-0.5 font-mono text-[11px] text-brand-dark-gray ring-1 ring-brand-light-gray-1"
                  >
                    {model.label}
                  </span>
                ))}
                {!endpoint.models.length && (
                  <span className="font-body text-[11px] text-amber-700">
                    还没有列出模型——请编辑这个服务并添加模型，之后才能选择它。
                  </span>
                )}
              </div>
              {(results[endpoint.id] || endpoint.last_error) && (
                <p
                  className={`mt-2 font-body text-[11px] ${
                    endpoint.last_status === "ok" ? "text-brand-teal" : "text-red-600"
                  }`}
                >
                  {results[endpoint.id] || endpoint.last_error}
                </p>
              )}
            </div>
          );
        })}

        {editingId === "new" && (
          <EndpointForm
            initial={EMPTY_FORM}
            editing={null}
            onCancel={() => setEditingId(null)}
            onSaved={afterChange}
          />
        )}

        {!endpoints.length && editingId !== "new" && (
          <div className="rounded-lg border border-dashed border-brand-light-gray-1 px-4 py-6 text-center">
            <p className="font-body text-sm text-brand-gray">还没有添加模型服务。</p>
            <p className="mx-auto mt-1 max-w-md font-body text-xs leading-relaxed text-brand-mid-gray">
              你可以添加本机模型（通常不需要密钥），也可以添加云端模型服务（需要对应的 API 密钥）。
            </p>
            <button
              onClick={() => setEditingId("new")}
              className="mt-3 rounded bg-brand-teal px-3 py-1.5 font-body text-xs font-medium text-white"
            >
              添加第一个模型服务
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
