import { useCallback, useEffect, useState } from "react";
import type {
  AgentConfig,
  AnalystLens,
  DesktopUpdateController,
  KnowledgeSource,
  ModelInfo,
  PiiShieldStatus, PrivacyConfig,
} from "../types";
import * as api from "../services/api";
import { agentDisplayName } from "../utils/agentLabels";
import { groupModels, optionLabel, optionState, recommendationFor, runsLocally } from "../lib/modelOptions";
import { useConfirm } from "./ConfirmProvider";
import DiarizationCapabilityCard from "./DiarizationCapabilityCard";
import BatchTranscriptionCard from "./BatchTranscriptionCard";
import LocalModelFitCard from "./LocalModelFitCard";
import ApiKeysCard from "./ApiKeysCard";
import EndpointsCard from "./EndpointsCard";
import CliToolsCard from "./CliToolsCard";
import PiiShieldCard from "./PiiShieldCard";
import PrivacyModeCard from "./PrivacyModeCard";
import ProviderOnboardingCard from "./ProviderOnboardingCard";
import AboutCard from "./AboutCard";

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  audio: { label: "音频", color: "#0d9488" },
  text: { label: "文字", color: "#7c3aed" },
  meta: { label: "辅助信息", color: "#f59e0b" },
  db: { label: "知识库", color: "#10b981" },
};

// Backend default cadence per agent. Text agents run on a fixed cycle; the
// Principal Agent and Opportunity Specialist are event-driven, so their value
// is the minimum cooldown between runs.
const INTERVAL_DEFAULTS: Record<string, number> = {
  consolidated_analyst: 40,
  objection_handler: 10,
  synthesizer: 75,
  opportunity_specialist: 55,
  strategic_signals: 45,
  transcript_refiner: 45,
};

// Grouped by when agents run, not by their internal type: the Principal
// Agent (meta) and Opportunity Specialist (db) react to live insights, while
// Strategic Signals cycles over the live context and the briefing trio runs
// only after a session or on demand. Slug order within a section is display order.
const AGENT_SECTIONS: { slugs: string[]; title: string; blurb: string }[] = [
  {
    slugs: ["audio_gateway"],
    title: "实时听取",
    blurb: "把会议声音实时送给后台听取，马上生成临时文字。",
  },
  {
    slugs: ["consolidated_analyst", "objection_handler", "synthesizer", "opportunity_specialist", "strategic_signals", "transcript_refiner"],
    title: "实时分析",
    blurb: "会议进行时持续分析：找出并完善重点信息，匹配相关资料，并及时更新现场提示卡。",
  },
  {
    slugs: ["brief_meeting_lens", "brief_discovery_lens", "brief_arbiter"],
    title: "会后总结",
    blurb: "结束会议后自动运行，也可以手动运行：两个分析角度先分别整理内容，再汇总成最终总结。",
  },
];

export type AdminTab = "agents" | "transcription" | "privacy" | "keys" | "about";

const TABS: { id: AdminTab; label: string; hint: string }[] = [
  { id: "agents", label: "分析助手", hint: "设置每个分析助手使用的模型、提示词和工作方式" },
  { id: "transcription", label: "转文字与声音", hint: "设置区分说话人和批量转文字的方式" },
  { id: "privacy", label: "隐私", hint: "不让任何模型（本地或云端）接触个人资料" },
  { id: "keys", label: "连接服务", hint: "连接 AI 服务商、自己电脑上的模型服务和终端 AI 工具" },
  { id: "about", label: "关于", hint: "查看软件版本和更新说明" },
];

interface AdminPanelProps {
  onBack: () => void;
  desktopUpdate: DesktopUpdateController;
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  // Version this browser last ran before an upgrade; forwarded to the About
  // tab so releases since then are badged, with an unread dot on the tab.
  highlightSince?: string | null;
  // True only when opened from the welcome checklist's "Add API key" action:
  // the API Keys tab then leads with the contextual first-run setup card.
  // Direct entry through Administration stays the normal expert view.
  onboarding?: boolean;
  onOnboardingContinue?: () => void;
}

// Compact filter-chip toggle used for multi-select groups (knowledge sources,
// analyst lenses). Selected chips fill teal with a check; unselected chips stay
// muted outlines so large collections read as a quiet tag cloud.
function TogglePill({ label, selected, onToggle }: { label: string; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-body text-xs transition-colors ${
        selected
          ? "border-brand-teal/40 bg-brand-teal/10 font-medium text-brand-teal"
          : "border-brand-light-gray-1 bg-surface text-brand-mid-gray hover:border-brand-mid-gray hover:text-brand-dark-gray"
      }`}
    >
      {selected && (
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {label}
    </button>
  );
}

// Built-in insight types with special pipeline behavior; lenses can also
// surface findings as a custom type, which flows through the live view,
// post-call summary, and exports as its own first-class group.
const BUILTIN_LENS_TYPES: { value: string; label: string }[] = [
  { value: "question", label: "问题（跟踪回答）" },
  { value: "observation", label: "观察" },
  { value: "opportunity", label: "机会（匹配知识库）" },
  { value: "action_item", label: "行动事项" },
];
const BUILTIN_LENS_TYPE_VALUES = new Set(BUILTIN_LENS_TYPES.map((o) => o.value));
const CUSTOM_TYPE_SENTINEL = "__custom__";

// Mirror of the backend's item_type slug rules (lowercase letters, digits,
// underscores; must start with a letter; max 50 chars).
function slugifyTypeName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 50);
  return slug || "custom";
}

function humanizeTypeSlug(slug: string): string {
  return slug.split("_").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function parseLenses(raw: string): AnalystLens[] {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.filter((l): l is AnalystLens => !!l && typeof l === "object") : [];
  } catch {
    return [];
  }
}

// Editor for the Consolidated Analyst's configurable lenses. Each lens owns a
// prompt section that is concatenated into the system prompt's {lens_sections}
// placeholder when the lens is enabled; item_type picks the insight bucket its
// findings surface as.
function LensEditor({
  agent,
  onUpdate,
  onDraftChange,
}: {
  agent: AgentConfig;
  onUpdate: (slug: string, field: string, value: string | boolean | number | null) => void;
  onDraftChange: (slug: string, field: "prompt" | "interval_seconds" | "lenses", value: string | number) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { confirm } = useConfirm();
  const lenses = parseLenses(agent.lenses);
  const missingPlaceholder = !agent.prompt.includes("{lens_sections}");

  const save = (next: AnalystLens[]) => onUpdate(agent.slug, "lenses", JSON.stringify(next));
  const draft = (next: AnalystLens[]) => onDraftChange(agent.slug, "lenses", JSON.stringify(next));
  const patched = (key: string, patch: Partial<AnalystLens>) =>
    lenses.map((l) => (l.key === key ? { ...l, ...patch } : l));

  const addLens = () => {
    let n = lenses.length + 1;
    while (lenses.some((l) => l.key === `lens-${n}`)) n += 1;
    const key = `lens-${n}`;
    save([...lenses, { key, label: "新分析角度", item_type: "observation", enabled: true, prompt: "" }]);
    setExpandedKey(key);
  };

  const deleteLens = async (lens: AnalystLens) => {
    const ok = await confirm({
      title: "删除分析角度",
      message: `要删除“${lens.label}”分析角度及其提示词吗？`,
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    if (expandedKey === lens.key) setExpandedKey(null);
    save(lenses.filter((l) => l.key !== lens.key));
  };

  return (
    <div className="border-t border-brand-light-gray-1/70 px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <label className="block font-body text-xs font-medium text-brand-gray">分析角度</label>
        <button
          type="button"
          onClick={addLens}
          className="rounded-full border border-brand-light-gray-1 px-2.5 py-1 font-body text-[11px] font-medium text-brand-gray transition-colors hover:border-brand-teal hover:text-brand-teal"
        >
          + Add Lens
        </button>
      </div>

      <div className="space-y-1.5">
        {lenses.map((lens) => {
          const expanded = expandedKey === lens.key;
          const isBuiltinType = BUILTIN_LENS_TYPE_VALUES.has(lens.item_type);
          const typeBadge = isBuiltinType
            ? BUILTIN_LENS_TYPES.find((o) => o.value === lens.item_type)!.label.replace(/ \(.*\)$/, "")
            : humanizeTypeSlug(lens.item_type);
          const emptyPrompt = !lens.prompt.trim();
          return (
            <div key={lens.key} className={`rounded-lg border ${expanded ? "border-brand-teal/40" : "border-brand-light-gray-1"} bg-surface`}>
              <div className="flex items-center gap-2.5 px-3 py-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={lens.enabled}
                  title={lens.enabled ? "已加入提示词" : "未加入提示词"}
                  onClick={() => save(patched(lens.key, { enabled: !lens.enabled }))}
                  className={`h-4 w-7 shrink-0 rounded-full transition-colors ${lens.enabled ? "bg-brand-teal" : "bg-brand-light-gray-1"}`}
                >
                  <span className={`block h-3 w-3 rounded-full bg-surface shadow transition-transform ${lens.enabled ? "translate-x-3.5" : "translate-x-0.5"}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedKey(expanded ? null : lens.key)}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className={`truncate font-body text-xs font-medium ${lens.enabled ? "text-brand-dark-gray" : "text-brand-mid-gray"}`}>
                    {lens.label}
                  </span>
                  <span className="shrink-0 rounded-full bg-brand-light-gray-2 px-2 py-0.5 font-body text-[10px] text-brand-gray">
                    {typeBadge}
                  </span>
                  {emptyPrompt && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-body text-[10px] text-amber-800" title="没有提示词的分析角度会被跳过">
                      没有提示词
                    </span>
                  )}
                  <svg className={`ml-auto h-3 w-3 shrink-0 text-brand-mid-gray transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => deleteLens(lens)}
                  title="删除分析角度"
                  className="shrink-0 rounded p-1 text-brand-mid-gray transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>

              {expanded && (
                <div className="space-y-3 border-t border-brand-light-gray-1/70 px-3 py-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block font-body text-[10px] font-medium text-brand-gray">角度名称</label>
                      <input
                        type="text"
                        value={lens.label}
                        onChange={(e) => draft(patched(lens.key, { label: e.target.value }))}
                        onBlur={(e) => save(patched(lens.key, { label: e.target.value.trim() || "未命名角度" }))}
                        className="w-full rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 font-body text-xs text-brand-dark-gray focus:border-brand-teal"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-body text-[10px] font-medium text-brand-gray">结果显示为</label>
                      <select
                        value={isBuiltinType ? lens.item_type : CUSTOM_TYPE_SENTINEL}
                        onChange={(e) => {
                          const v = e.target.value;
                          save(patched(lens.key, {
                            item_type: v === CUSTOM_TYPE_SENTINEL ? slugifyTypeName(lens.label) : v,
                          }));
                        }}
                        className="w-full rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 font-body text-xs text-brand-dark-gray focus:border-brand-teal"
                      >
                        {BUILTIN_LENS_TYPES.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                        <option value={CUSTOM_TYPE_SENTINEL}>自定义类型…</option>
                      </select>
                      {!isBuiltinType && (
                        <input
                          type="text"
                          value={lens.item_type}
                          onChange={(e) => draft(patched(lens.key, { item_type: e.target.value }))}
                          onBlur={(e) => save(patched(lens.key, { item_type: slugifyTypeName(e.target.value) }))}
                          placeholder="自定义类型名称"
                          className="mt-1.5 w-full rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 font-mono text-xs text-brand-dark-gray focus:border-brand-teal"
                        />
                      )}
                      <p className="mt-1 font-body text-[10px] text-brand-mid-gray">
                        {isBuiltinType
                          ? "内置类型会启用额外功能：问题可以跟踪回答，机会会交给机会助手去匹配知识库。"
                          : "自定义类型会有单独的筛选标签、总结栏目和导出名称。只能使用小写字母、数字和下划线，不能交给机会助手自动匹配。"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block font-body text-[10px] font-medium text-brand-gray">角度提示词</label>
                    <textarea
                      value={lens.prompt}
                      onChange={(e) => draft(patched(lens.key, { prompt: e.target.value }))}
                      onBlur={(e) => save(patched(lens.key, { prompt: e.target.value }))}
                      rows={8}
                      placeholder="说明这个分析角度要关注什么、应该怎样思考……"
                      className="w-full resize-y rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 px-3 py-2 font-mono text-xs leading-relaxed text-brand-dark-gray focus:border-brand-teal"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {lenses.length === 0 && (
          <p className="rounded-lg border border-dashed border-brand-light-gray-1 px-3 py-4 text-center font-body text-xs text-brand-mid-gray">
            还没有设置分析角度，分析助手不会产出重点信息。请先添加一个分析角度。
          </p>
        )}
      </div>

      <p className="mt-2 font-body text-[10px] text-brand-mid-gray">
        每个启用的分析角度都会通过 {"{lens_sections}"} 占位符加入系统提示词，并用所选类型标记结果。关闭后，下次会议就不会加入这一段。
      </p>
      {missingPlaceholder && (
        <p className="mt-1 font-body text-[10px] text-amber-700">
          下面的系统提示词没有 {"{lens_sections}"} 占位符，因此分析角度不会插入。请恢复默认提示词，或把占位符放到合适的位置。
        </p>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  models,
  knowledgeSources,
  isSaving,
  localOnly,
  lockLabel = "隐私优先",
  onUpdate,
  onResetPrompt,
  onDraftChange,
}: {
  agent: AgentConfig;
  models: ModelInfo[];
  knowledgeSources: KnowledgeSource[];
  isSaving: boolean;
  localOnly: boolean;
  // Names the switch behind localOnly in the option suffix.
  lockLabel?: string;
  onUpdate: (slug: string, field: string, value: string | boolean | number | null) => void;
  onResetPrompt: (slug: string) => void;
  onDraftChange: (slug: string, field: "prompt" | "interval_seconds" | "lenses", value: string | number) => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const badge = TYPE_BADGES[agent.agent_type] || TYPE_BADGES.text;
  const intervalDefault = agent.agent_type === "text" ? INTERVAL_DEFAULTS[agent.slug] ?? 15 : INTERVAL_DEFAULTS[agent.slug];
  const intervalDriven = agent.agent_type === "text" || agent.slug === "strategic_signals";
  const modelOptions = models.filter((m) => (agent.agent_type === "audio" ? m.supports_live_audio : m.supports_text));
  const hasLockedModels = modelOptions.some((m) => m.key_available === false);
  // Privacy First judges the model this agent is actually assigned, not whether
  // a local one merely exists in the list: with a self-hosted model selected the
  // agent keeps running, and with a cloud one it sits out even though a local
  // option was available. An assigned model missing from the list (a removed
  // endpoint) cannot be shown to stay on this network, so it counts as blocked.
  // A per-model budget (written by the Transcription & Audio fit test) beats
  // interval_seconds whenever the agent runs that model, so the plain field is
  // not what the call will use. Surface the effective value or the applied
  // budget looks like it silently failed.
  const modelInterval = (() => {
    try {
      const parsed = JSON.parse(agent.model_intervals || "{}");
      const value = parsed?.[agent.model_id];
      return typeof value === "number" && value > 0 ? value : null;
    } catch {
      return null;
    }
  })();
  const selectedModel = modelOptions.find((m) => m.id === agent.model_id);
  const blockedByPrivacy = Boolean(
    localOnly && agent.model_id && !(selectedModel && runsLocally(selectedModel))
  );
  const hasLocalAlternative = modelOptions.some(runsLocally);

  return (
    <div className={`rounded-xl bg-surface shadow-sm ring-1 ring-brand-light-gray-1/60 transition-opacity ${isSaving ? "opacity-70" : ""} ${agent.enabled && !blockedByPrivacy ? "" : "opacity-80"}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-bold text-brand-dark-gray">{agentDisplayName(agent.slug, agent.name)}</h3>
            <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: badge.color }}>
              {badge.label}
            </span>
            <span className="font-mono text-[10px] text-brand-mid-gray">{agent.slug}</span>
            {!agent.enabled && (
              <span className="inline-flex rounded-full bg-brand-light-gray-1/80 px-2 py-0.5 text-[10px] font-medium text-brand-gray">
                已停用
              </span>
            )}
            {agent.enabled && !agent.model_id && (
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                需要选择模型
              </span>
            )}
            {agent.enabled && blockedByPrivacy && (
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                未运行：隐私优先
              </span>
            )}
          </div>
          <p className="mt-1 font-body text-xs leading-relaxed text-brand-gray">{agent.description}</p>
          {agent.agent_type === "audio" && (
            <p className="mt-2 rounded border border-brand-light-gray-1 bg-brand-light-gray-2/60 px-2.5 py-1.5 font-body text-[11px] leading-relaxed text-brand-gray">
              这是实时声音连接器，因此这里只显示支持实时声音的模型。自己电脑上的
              （兼容 OpenAI 的聊天模型）只能处理文字，不会显示在这里；它们用于运行
              文字分析助手。若要完全离线转文字，请在
              转文字与声音中选择本地 ONNX 模型。
            </p>
          )}
          {agent.slug === "opportunity_specialist" && (
            <p className="mt-2 rounded border border-brand-light-gray-1 bg-brand-light-gray-2/60 px-2.5 py-1.5 font-body text-[11px] leading-relaxed text-brand-gray">
              它会在综合分析助手之后运行，本身不会主动寻找机会。当某个分析角度发现“机会”时，它会拿下面的知识库进行匹配，并把匹配结果补充到原来的卡片中。只有“客户销售”和“客户交付”两种会议类型会启用它。
            </p>
          )}
          {blockedByPrivacy && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-body text-[11px] leading-relaxed text-amber-900">
              {hasLocalAlternative ? (
                <>
                  隐私优先模式已开启，但这个助手使用的模型会把
                  资料发到你的网络之外，因此不会运行。请在下面选择自己电脑或局域网里的模型
                  ，这样就能重新运行；这些模型会在本机或局域网内运行。
                </>
              ) : (
                <>
                  隐私优先模式已开启，但这个助手没有可用的本地模型，
                  因此不会运行。请在“连接服务”中添加本机或局域网里的兼容 OpenAI 模型服务，
                  或者关闭隐私优先模式。无论选择哪种方式，它的设置
                  都会保留。
                </>
              )}
            </p>
          )}
        </div>
        <button
          onClick={() => onUpdate(agent.slug, "enabled", !agent.enabled)}
          className={`h-6 w-11 shrink-0 rounded-full transition-colors ${agent.enabled ? "bg-brand-teal" : "bg-brand-light-gray-1"}`}
          role="switch"
          aria-checked={agent.enabled}
          title={agent.enabled ? "已启用" : "已停用"}
        >
          <span className={`block h-5 w-5 rounded-full bg-surface shadow transition-transform ${agent.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {/* Settings grid: model + cadence side by side */}
      <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block font-body text-xs font-medium text-brand-gray">模型</label>
          <select
            value={agent.model_id}
            onChange={(e) => onUpdate(agent.slug, "model_id", e.target.value)}
            className="w-full rounded border border-brand-light-gray-1 bg-surface px-3 py-1.5 text-sm text-brand-dark-gray focus:border-brand-teal"
          >
            <option value="">未选择</option>
            {groupModels(modelOptions).map((group) => (
              <optgroup key={group.provider} label={group.provider}>
                {group.models.map((m) => {
                  const { locked, suffix } = optionState(m, agent.model_id, localOnly, lockLabel);
                  return (
                    <option key={m.id} value={m.id} disabled={locked}>
                      {optionLabel(m, agent.slug)}{suffix}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          {hasLockedModels && (
            <p className="mt-1 font-body text-[10px] text-brand-mid-gray">
              灰色模型需要先填写对应服务商的 API 密钥（请到“连接服务”查看）
            </p>
          )}
        </div>

        {intervalDefault !== undefined && (
          <div>
            <label className="mb-1 block font-body text-xs font-medium text-brand-gray">
              {intervalDriven ? "运行间隔" : "两次运行的最短间隔"}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={300}
                value={agent.interval_seconds ?? intervalDefault}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) onDraftChange(agent.slug, "interval_seconds", val);
                }}
                onBlur={(e) => {
                  const val = Math.max(5, Math.min(300, parseInt(e.target.value, 10) || intervalDefault));
                  onUpdate(agent.slug, "interval_seconds", val);
                }}
                className="w-20 rounded border border-brand-light-gray-1 bg-surface px-2.5 py-1.5 text-center font-mono text-sm text-brand-dark-gray focus:border-brand-teal"
              />
              <span className="font-body text-xs text-brand-mid-gray">秒</span>
            </div>
            <p className="mt-1 font-body text-[10px] text-brand-mid-gray">
              {intervalDriven
                ? "这个助手多久分析一次新文字（5～300 秒）"
                : "两次运行至少间隔多久；有新的重点信息时触发（5～300 秒）"}
            </p>
            {modelInterval !== null && (
              <p className="mt-1.5 rounded border border-brand-teal/30 bg-brand-teal/5 px-2 py-1.5 font-body text-[10px] leading-relaxed text-brand-dark-gray">
                <span className="font-medium">当前按 {modelInterval} 秒运行</span>，使用
                所选模型。本机模型测试为它设置了这个间隔，{" "}
                {selectedModel?.name ?? agent.model_id}；它会覆盖上面的设置
                （仅在这个助手使用该模型时生效）。如需修改，请到
                转文字与声音重新测试。
              </p>
            )}
          </div>
        )}
      </div>

      {/* Knowledge sources (for db-backed agents) */}
      {agent.agent_type === "db" && (
        <div className="border-t border-brand-light-gray-1/70 px-5 py-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <label className="block font-body text-xs font-medium text-brand-gray">知识库</label>
            {agent.knowledge_source_ids.split(",").some((s) => s.trim()) && (
              <button
                type="button"
                onClick={() => onUpdate(agent.slug, "knowledge_source_ids", "")}
                className="font-body text-[10px] text-brand-mid-gray transition-colors hover:text-brand-teal"
              >
                清空选择
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {knowledgeSources
              .filter((k) => k.active)
              .map((k) => {
                const selected = agent.knowledge_source_ids.split(",").map((s) => s.trim()).includes(k.id);
                return (
                  <TogglePill
                    key={k.id}
                    label={k.name}
                    selected={selected}
                    onToggle={() => {
                      const current = new Set(agent.knowledge_source_ids.split(",").map((s) => s.trim()).filter(Boolean));
                      if (selected) current.delete(k.id); else current.add(k.id);
                      onUpdate(agent.slug, "knowledge_source_ids", [...current].join(","));
                    }}
                  />
                );
              })}
          </div>
          <p className="mt-1 font-body text-[10px] text-brand-mid-gray">
            这个助手会用所选知识库匹配机会（可在“知识库”页面管理）。如果不选任何知识库，就会使用软件内置的“服务目录”。
          </p>
        </div>
      )}

      {/* Configurable analysis lenses (for consolidated analyst) */}
      {agent.slug === "consolidated_analyst" && (
        <LensEditor agent={agent} onUpdate={onUpdate} onDraftChange={onDraftChange} />
      )}

      {/* Prompt editor — collapsed by default to keep the page scannable */}
      <div className="border-t border-brand-light-gray-1/70">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          aria-expanded={promptOpen}
          className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-brand-light-gray-2/60"
        >
          <span className="flex items-center gap-2 font-body text-xs font-medium text-brand-gray">
            <svg className={`h-3 w-3 text-brand-mid-gray transition-transform ${promptOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            系统提示词
          </span>
          <span className="font-body text-[10px] text-brand-mid-gray">{promptOpen ? "收起" : "查看 / 编辑"}</span>
        </button>
        {promptOpen && (
          <div className="px-5 pb-5">
            <div className="mb-1 flex justify-end">
              <button
                onClick={() => onResetPrompt(agent.slug)}
                className="font-body text-[10px] text-brand-mid-gray transition-colors hover:text-brand-teal"
              >
                恢复默认
              </button>
            </div>
            <textarea
              value={agent.prompt}
              onChange={(e) => onDraftChange(agent.slug, "prompt", e.target.value)}
              onBlur={(e) => onUpdate(agent.slug, "prompt", e.target.value)}
              rows={12}
              className="w-full resize-y rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 px-3 py-2 font-mono text-xs leading-relaxed text-brand-dark-gray focus:border-brand-teal"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPanel({ onBack, desktopUpdate, activeTab, onTabChange, highlightSince, onboarding, onOnboardingContinue }: AdminPanelProps) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyConfig | null>(null);
  // The PII Shield locks audio models alone (a cloud gateway or transcriber
  // would hear the names it withholds); text models stay free.
  const [piiShield, setPiiShield] = useState<PiiShieldStatus | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  // Bumped on credential changes so the onboarding card re-checks readiness.
  const [keysRefresh, setKeysRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, m, k, p, meta, shield] = await Promise.all([
        api.listAgents(),
        api.listModels(),
        api.listKnowledgeSources(),
        api.getPrivacyConfig(),
        // Version is cosmetic here; never let it fail the whole panel
        api.getAppMeta().catch(() => null),
        api.getPiiShield().catch(() => null),
      ]);
      setAgents(a);
      setModels(m);
      setKnowledgeSources(k);
      setPrivacy(p);
      setPiiShield(shield);
      setVersion(meta?.version ?? null);
    } catch (err) {
      console.error("Failed to load agent configs", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Key changes flip model availability; refresh models without re-entering the loading state
  const refreshModels = useCallback(async () => {
    try {
      setModels(await api.listModels());
    } catch (err) {
      console.error("Failed to refresh models", err);
    }
  }, []);

  // The transcription card's live preview selector edits the Audio Bridge
  // agent's model; refresh agents so its card shows the new value.
  const refreshAgents = useCallback(async () => {
    try {
      setAgents(await api.listAgents());
    } catch (err) {
      console.error("Failed to refresh agents", err);
    }
  }, []);

  const handleUpdate = async (slug: string, field: string, value: string | boolean | number | null) => {
    setSaving(slug);
    try {
      let updated = await api.updateAgent(slug, { [field]: value });
      if (field === "model_id" && typeof value === "string") {
        const selected = models.find((model) => model.id === value);
        const recommendation = selected
          ? recommendationFor(selected, slug)
          : undefined;
        if (
          recommendation?.source === "local_fit"
          && recommendation.interval_seconds
        ) {
          await api.applyLocalFitIntervals(value, [
            { slug, interval_seconds: recommendation.interval_seconds },
          ]);
          updated = (await api.listAgents()).find((agent) => agent.slug === slug) ?? updated;
        }
      }
      setAgents((prev) => prev.map((a) => (a.slug === slug ? updated : a)));
    } catch (err) {
      console.error("Update failed", err);
    } finally {
      setSaving(null);
    }
  };

  const handleResetPrompt = async (slug: string) => {
    setSaving(slug);
    try {
      const updated = await api.resetAgentPrompt(slug);
      setAgents((prev) => prev.map((a) => (a.slug === slug ? updated : a)));
    } catch (err) {
      console.error("Reset failed", err);
    } finally {
      setSaving(null);
    }
  };

  const handleDraftChange = (slug: string, field: "prompt" | "interval_seconds" | "lenses", value: string | number) => {
    setAgents((prev) => prev.map((a) => (a.slug === slug ? { ...a, [field]: value } : a)));
  };

  const enabledCount = agents.filter((a) => a.enabled).length;
  const activeTabInfo = TABS.find((t) => t.id === activeTab) || TABS[0];
  const audioLocked = piiShield?.settings.enabled ?? false;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden bg-brand-light-gray-2">
      <header className="border-b border-brand-light-gray-1 bg-surface px-4 pt-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded p-1 text-brand-mid-gray transition-colors hover:bg-brand-light-gray-2 hover:text-brand-dark-gray" title="返回">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="font-display text-lg font-bold text-brand-dark-gray">管理设置</h1>
              {version && (
                <span className="rounded-full bg-brand-light-gray-2 px-2 py-0.5 font-mono text-[11px] font-medium text-brand-gray" title="软件版本">
                  v{version}
                </span>
              )}
            </div>
            <p className="font-body text-xs text-brand-mid-gray">{activeTabInfo.hint}</p>
          </div>
        </div>

        {/* Tab bar */}
        <nav className="mt-3 flex flex-wrap gap-1" aria-label="管理设置栏目">
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px shrink-0 border-b-2 px-2 py-2 font-body text-sm font-medium transition-colors sm:px-4 ${
                  active
                    ? "border-brand-teal text-brand-teal"
                    : "border-transparent text-brand-gray hover:border-brand-light-gray-1 hover:text-brand-dark-gray"
                }`}
              >
                {tab.label}
                {tab.id === "about" && highlightSince && (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-teal align-middle" title="有新的更新说明" />
                )}
                {tab.id === "agents" && !loading && (
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-brand-teal/10 text-brand-teal" : "bg-brand-light-gray-2 text-brand-mid-gray"}`}>
                    {enabledCount}/{agents.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="font-body text-sm text-brand-mid-gray">正在加载设置……</span>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl">
            {/* Global switch shown on every settings tab: it changes which
                models and agents below can run at all. About is read-only, so
                it skips the switch. In first-run onboarding the keys tab
                frames Privacy First inside the setup card instead. */}
            {activeTab !== "about" && !(activeTab === "keys" && onboarding) && (
              <div className="mb-6">
                <PrivacyModeCard config={privacy} onChanged={setPrivacy} />
              </div>
            )}

            {/* All tabs stay mounted so in-progress work (e.g. a diarization
                benchmark recording) survives tab switches. */}
            <div className={activeTab === "agents" ? "space-y-8" : "hidden"}>
              {(() => {
                const assigned = new Set(AGENT_SECTIONS.flatMap((s) => s.slugs));
                const leftover = agents.filter((a) => !assigned.has(a.slug));
                const sections = [
                  ...AGENT_SECTIONS.map((s) => ({
                    ...s,
                    agents: s.slugs
                      .map((slug) => agents.find((a) => a.slug === slug))
                      .filter((a): a is AgentConfig => !!a),
                  })),
                  // Safety net so agents added later never silently disappear
                  { title: "其他", blurb: "尚未归类的分析助手。", agents: leftover },
                ];
                return sections.filter((s) => s.agents.length > 0);
              })().map((section) => {
                const sectionAgents = section.agents;
                return (
                  <section key={section.title}>
                    <div className="mb-3">
                      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-brand-mid-gray">{section.title}</h2>
                      <p className="mt-0.5 font-body text-xs text-brand-mid-gray">{section.blurb}</p>
                    </div>
                    <div className="space-y-4">
                      {sectionAgents.map((agent) => (
                        <AgentCard
                          key={agent.slug}
                          agent={agent}
                          models={models}
                          knowledgeSources={knowledgeSources}
                          isSaving={saving === agent.slug}
                          localOnly={(privacy?.local_only ?? false) || (agent.agent_type === "audio" && audioLocked)}
                          lockLabel={privacy?.local_only ? "隐私优先" : "个人信息保护"}
                          onUpdate={handleUpdate}
                          onResetPrompt={handleResetPrompt}
                          onDraftChange={handleDraftChange}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className={activeTab === "transcription" ? "space-y-4" : "hidden"}>
              <BatchTranscriptionCard
                models={models}
                localOnly={(privacy?.local_only ?? false) || audioLocked}
                lockLabel={privacy?.local_only ? "隐私优先" : "个人信息保护"}
                onLiveModelChanged={refreshAgents}
                gatewayModelId={agents.find((a) => a.slug === "audio_gateway")?.model_id}
              />
              <LocalModelFitCard onIntervalsApplied={refreshAgents} />
              <DiarizationCapabilityCard />
            </div>

            {/* Privacy First (above, on every tab) decides where processing
                happens; the shield decides what any model gets to read. */}
            <div className={activeTab === "privacy" ? "space-y-4" : "hidden"}>
              <PiiShieldCard onChanged={setPiiShield} />
            </div>

            <div className={activeTab === "keys" ? "space-y-4" : "hidden"}>
              {onboarding && (
                <ProviderOnboardingCard
                  privacy={privacy}
                  onPrivacyChanged={setPrivacy}
                  refreshToken={keysRefresh}
                  onContinue={() => onOnboardingContinue?.()}
                />
              )}
              <ApiKeysCard
                onChanged={() => {
                  refreshModels();
                  setKeysRefresh((n) => n + 1);
                }}
              />
              {/* Adding or removing an endpoint changes which models exist, and
                  an on-prem one changes what Privacy First can still run. */}
              <EndpointsCard
                onChanged={() => {
                  refreshModels();
                  void api.getPrivacyConfig().then(setPrivacy).catch(() => {});
                }}
              />
              <CliToolsCard />
            </div>

            <div className={activeTab === "about" ? "" : "hidden"}>
              <AboutCard version={version} desktopUpdate={desktopUpdate} highlightSince={highlightSince} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
