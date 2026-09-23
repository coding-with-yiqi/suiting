import { useEffect, useState } from "react";
import type { PiiCategory, PiiEgressEntry, PiiPreview, PiiShieldSettings, PiiShieldStatus } from "../types";
import * as api from "../services/api";
import { ModelDownloadRow } from "./ModelDownloads";

// The PII Shield settings card: the switch, what it covers (honestly), the
// categories it looks for, the user's own protected terms, the on-device
// model's state, and a scratch box to see what a sentence turns into.

const SAMPLE =
  "你好，我是赛博科技的莎拉·康纳。关于第三季度续约，请发邮件到 sarah.connor@cyberdyne.com，或拨打 555-867-5309。";

const CATEGORY_HINTS: Partial<Record<PiiCategory, string>> = {
  PERSON: "说话人的姓名始终识别；其他姓名由本机模型和自我介绍来识别。",
  ORG: "公司名称由本机模型和你设置的保护词来识别。",
  LOCATION: "默认关闭：地点名称通常只是分析内容，不一定属于个人身份。",
};

const TERM_LABELS: Partial<Record<PiiCategory, string>> = { ORG: "组织", PERSON: "人物", LOCATION: "地点" };
const CATEGORY_LABELS: Partial<Record<PiiCategory, string>> = { ORG: "组织名称", PERSON: "人物姓名", LOCATION: "地点名称" };

type Update = Partial<PiiShieldSettings>;

const checkboxClass = "h-4 w-4 rounded border-brand-light-gray-1 text-brand-teal";
const smallButtonClass =
  "rounded-md border border-brand-light-gray-1 px-2.5 py-1 font-body text-xs font-medium text-brand-dark-gray transition-colors hover:bg-brand-light-gray-2 disabled:opacity-60";

function CoverageRow({ label, covered, detail }: { label: string; covered: boolean; detail: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden="true"
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${covered ? "bg-brand-teal" : "bg-amber-500"}`}
      />
      <div className="min-w-0">
        <p className="font-body text-xs font-semibold text-brand-dark-gray">
          {label}
          <span className={`ml-2 font-normal ${covered ? "text-brand-teal" : "text-amber-700 dark:text-amber-300"}`}>
            {covered ? "已保护" : "未保护"}
          </span>
        </p>
        <p className="font-body text-[11px] leading-relaxed text-brand-mid-gray">{detail}</p>
      </div>
    </li>
  );
}

function CoverageList({ status }: { status: PiiShieldStatus }) {
  const { coverage, settings } = status;
  const gateway = coverage.live_gateway;
  const refinement = coverage.refinement;
  const gatewayDetail = gateway.paused
    ? `已设置 ${gateway.model_id}，但保护功能开启时会跳过它：云端连接器可能听到保护功能隐藏的姓名。只有声音连接器使用本机字幕功能时，实时字幕才会开启。`
    : !gateway.covered
      ? `实时声音会发送到 ${gateway.model_id} 生成临时字幕。请改用本机字幕功能，或在“分析助手”中关闭它。`
      : gateway.model_id
        ? `连接器在本机运行（${gateway.model_id}）。`
        : "声音连接器已关闭，或没有选择模型，因此实时声音不会离开这台电脑。";
  return (
    <ul className="mt-4 divide-y divide-brand-light-gray-2 rounded-lg border border-brand-light-gray-1 px-3">
      <CoverageRow
        label="会议文字、重点、总结、聊天和文档"
        covered={coverage.text}
        detail={settings.enabled
          ? "每句话在写入时都会替换为代号，因此发给模型的提示词只包含干净文字。云端文字模型只能看到代号。"
          : "开启保护后，新文字才会替换为代号。之前记录的会议会保留原内容，直到你手动保护它们。"}
      />
      <CoverageRow
        label="转文字使用的声音"
        covered={coverage.transcription.covered}
        detail={coverage.transcription.covered
          ? coverage.enforced
            ? `声音无法替换为代号，因此保护功能开启时只能使用本地模型（${coverage.transcription.model_id}）转文字；云端转文字模型已在“转文字与声音”中锁定。`
            : `转文字在这台电脑上完成（${coverage.transcription.model_id}），声音不会离开本机。`
          : `会议声音会发送到 ${coverage.transcription.model_id} 转文字，说话人的姓名也会随之发送。开启保护后，转文字会固定使用本地模型。`}
      />
      <CoverageRow label="实时字幕（声音连接器）" covered={gateway.covered} detail={gatewayDetail} />
      {/* The badge answers a privacy question; whether the stage runs is a
          detail below it. Reading the agent's on/off switch as coverage put a
          red "not covered" on a state that leaks nothing (ALP-366). */}
      <CoverageRow
        label="文字润色"
        covered={refinement.covered}
        detail={refinement.covered
          ? `润色助手只读取已经替换成代号的文字，因此无论使用本地还是云端模型都受保护；只有完整保留原代号的改写才会保存。${refinement.enabled
              ? `当前使用 ${refinement.model_id}，每 ${refinement.interval_seconds} 秒运行一次，并在会议结束时再运行。`
              : "当前已关闭；请在“分析助手”中开启文字润色，修正标点、大小写和听错的内容。"}`
          : "开启保护后，新文字才会替换为代号；在此之前，润色助手会读取会议文字中的原内容。"}
      />
    </ul>
  );
}

function CategoryPicker({ status, saving, onToggle }: { status: PiiShieldStatus; saving: boolean; onToggle: (id: PiiCategory) => void }) {
  return (
    <section>
      <h4 className="font-body text-xs font-semibold uppercase tracking-wide text-brand-mid-gray">识别哪些内容</h4>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {status.categories.map((category) => (
          <label key={category.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-brand-light-gray-2">
            <input
              type="checkbox"
              checked={status.settings.categories.includes(category.id)}
              onChange={() => onToggle(category.id)}
              disabled={saving}
              className={`mt-0.5 ${checkboxClass}`}
            />
            <span className="font-body text-xs text-brand-dark-gray">
              {CATEGORY_LABELS[category.id] ?? category.label}
              {CATEGORY_HINTS[category.id] && (
                <span className="block text-[11px] text-brand-mid-gray">{CATEGORY_HINTS[category.id]}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function NerSection({ status, saving, onApply, onReload }: { status: PiiShieldStatus; saving: boolean; onApply: (u: Update) => void; onReload: () => Promise<void> }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ner, settings } = status;
  const label: Record<PiiShieldStatus["ner"]["state"], string> = {
    off: "关闭",
    ready: "已就绪",
    not_downloaded: settings.enabled ? "尚未下载" : "开启后下载",
    downloading: "下载中",
    unavailable: "不可用",
  };
  const badge = ner.state === "ready"
    ? "bg-brand-teal/10 text-brand-teal"
    : ner.state === "unavailable" ? "bg-red-50 text-red-700"
      : ner.state === "downloading" ? "bg-amber-50 text-amber-700"
        : "bg-brand-light-gray-2 text-brand-mid-gray";

  // Kicks the download off and returns; the progress row below reports it.
  // Waiting on the transfer here is what made the button look like a hang.
  const install = async () => {
    setStarting(true);
    setError(null);
    try {
      await api.installPiiNer();
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法安装本机模型。");
    } finally {
      setStarting(false);
    }
  };

  const running = ner.state === "downloading";

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-body text-xs font-semibold uppercase tracking-wide text-brand-mid-gray">本机姓名识别</h4>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}>{label[ner.state]}</span>
      </div>
      <p className="mt-1 font-body text-[11px] leading-relaxed text-brand-mid-gray">
        本机有一个小型的姓名实体模型（{ner.model}，约 110 MB），可以从普通文字中找出人物、公司和地点。
        只需下载一次，之后就能在电脑处理器上离线运行。即使不安装它，保护功能仍会识别说话人姓名、保护词、自我介绍、以前见过的姓名以及各种结构化编号。
      </p>
      {(error || (ner.state === "unavailable" && ner.error && !ner.download)) && (
        <p className="mt-1 font-mono text-[11px] text-red-700">{error || ner.error}</p>
      )}
      {ner.download && (
        <ModelDownloadRow download={ner.download} onRetry={() => void install()} />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-body text-xs text-brand-dark-gray">
          <input
            type="checkbox"
            checked={settings.ner}
            onChange={(e) => onApply({ ner: e.target.checked })}
            disabled={saving}
            className={checkboxClass}
          />
          使用本机模型
        </label>
        {settings.ner && ner.state !== "ready" && !running && (
          <button type="button" onClick={() => void install()} disabled={starting} className={smallButtonClass}>
            {starting ? "正在开始…" : ner.state === "unavailable" ? "重试下载" : "立即下载"}
          </button>
        )}
      </div>
    </section>
  );
}

function TermsSection({ settings, saving, onApply }: { settings: PiiShieldSettings; saving: boolean; onApply: (u: Update) => void }) {
  const [value, setValue] = useState("");
  const [category, setCategory] = useState<PiiCategory>("ORG");

  const add = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue("");
    if (settings.protected_terms.some((t) => t.value.toLowerCase() === trimmed.toLowerCase())) return;
    onApply({ protected_terms: [...settings.protected_terms, { value: trimmed, category }] });
  };
  const remove = (term: string) =>
    onApply({ protected_terms: settings.protected_terms.filter((t) => t.value !== term) });

  return (
    <section>
      <h4 className="font-body text-xs font-semibold uppercase tracking-wide text-brand-mid-gray">保护词</h4>
      <p className="mt-1 font-body text-[11px] leading-relaxed text-brand-mid-gray">
        把模型可能漏掉、且绝不能离开这台电脑的内容写在这里：客户公司、项目代号、不会在会议中自我介绍的人名。每次会议都会按完整词语匹配。
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="例如：示例公司"
          maxLength={200}
          className="min-w-[12rem] flex-1 rounded-md border border-brand-light-gray-1 bg-surface px-3 py-1.5 font-body text-xs text-brand-dark-gray placeholder:text-brand-mid-gray focus:border-brand-teal focus:ring-1 focus:ring-brand-teal-light"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as PiiCategory)}
          className="rounded-md border border-brand-light-gray-1 bg-surface px-2 py-1.5 font-body text-xs text-brand-dark-gray"
          aria-label="保护词类别"
        >
          <option value="ORG">组织</option>
          <option value="PERSON">人物</option>
          <option value="LOCATION">地点</option>
        </select>
        <button
          type="button"
          onClick={add}
          disabled={saving || !value.trim()}
          className="rounded-md bg-brand-teal px-3 py-1.5 font-body text-xs font-semibold text-white transition-colors hover:bg-brand-teal-dark disabled:opacity-50"
        >
          添加
        </button>
      </div>
      {settings.protected_terms.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {settings.protected_terms.map((term) => (
            <li key={term.value} className="inline-flex items-center gap-1 rounded-full border border-brand-light-gray-1 bg-brand-light-gray-2 py-0.5 pl-2.5 pr-1 font-body text-xs text-brand-dark-gray">
              {term.value}
              <span className="text-[10px] uppercase text-brand-mid-gray">{TERM_LABELS[term.category] ?? term.category.toLowerCase()}</span>
              <button
                type="button"
                onClick={() => remove(term.value)}
                aria-label={`删除 ${term.value}`}
                className="rounded-full p-0.5 text-brand-mid-gray hover:bg-brand-light-gray-1 hover:text-brand-dark-gray"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PreviewSection() {
  const [sample, setSample] = useState(SAMPLE);
  const [preview, setPreview] = useState<PiiPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!sample.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.previewPiiShield(sample));
    } catch (err) {
      setError(err instanceof Error ? err.message : "预览失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h4 className="font-body text-xs font-semibold uppercase tracking-wide text-brand-mid-gray">试写一句话</h4>
      <textarea
        value={sample}
        onChange={(e) => setSample(e.target.value)}
        rows={3}
        className="mt-2 w-full resize-none rounded-md border border-brand-light-gray-1 bg-surface px-3 py-2 font-body text-xs text-brand-dark-gray focus:border-brand-teal focus:ring-1 focus:ring-brand-teal-light"
      />
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => void run()} disabled={busy || !sample.trim()} className={`px-3 py-1.5 ${smallButtonClass}`}>
          {busy ? "扫描中…" : "预览模型将看到的内容"}
        </button>
        <span className="font-body text-[11px] text-brand-mid-gray">不会保存内容；预览会从 1 开始给信息打标签。</span>
      </div>
      {error && <p className="mt-2 font-body text-xs text-red-700">{error}</p>}
      {preview && (
        <div className="mt-3 rounded-md border border-brand-light-gray-1 bg-brand-light-gray-2/60 p-3">
          <p className="font-mono text-xs leading-relaxed text-brand-dark-gray">{preview.protected}</p>
          {preview.findings.length === 0 ? (
            <p className="mt-2 font-body text-[11px] text-brand-mid-gray">这段文字没有匹配到已启用的类别。</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {preview.findings.map((f, i) => (
                <li key={i} className="rounded-full border border-brand-light-gray-1 bg-surface px-2 py-0.5 font-body text-[11px] text-brand-dark-gray">
                  <span className="font-mono">{f.token}</span> = {f.text}
                  <span className="ml-1 text-brand-mid-gray">({f.source})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// What actually left for the models: the prompt log, newest first. Tokens
// show as tokens here (the route is not session-scoped), which is the point.
function EgressSection({ settings, saving, onApply }: { settings: PiiShieldSettings; saving: boolean; onApply: (u: Update) => void }) {
  const [entries, setEntries] = useState<PiiEgressEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      setEntries((await api.getPiiEgress(50)).entries);
    } catch (err) {
      console.error("Failed to load the prompt log", err);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = async () => {
    await api.clearPiiEgress().catch(() => {});
    setEntries([]);
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-body text-xs font-semibold uppercase tracking-wide text-brand-mid-gray">发给模型的内容</h4>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={busy} className={smallButtonClass}>{busy ? "加载中…" : "刷新"}</button>
          <button type="button" onClick={() => void clear()} disabled={busy || entries.length === 0} className={smallButtonClass}>清除记录</button>
        </div>
      </div>
      <p className="mt-1 font-body text-[11px] leading-relaxed text-brand-mid-gray">
        开启记录后，每条提示词都会按发送给模型时的原样写入数据目录，这样你能确认模型只看到了代号。保护功能开启时，如果提示词仍包含真实值，发送前会被拦截，并在这里标记出来。
      </p>
      <label className="mt-2 flex items-center gap-2 font-body text-xs text-brand-dark-gray">
        <input
          type="checkbox"
          checked={settings.prompt_log}
          onChange={(e) => onApply({ prompt_log: e.target.checked })}
          disabled={saving}
          className={checkboxClass}
        />
        记录发给模型的提示词
      </label>
      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-brand-light-gray-2 rounded-md border border-brand-light-gray-1">
          {entries.map((entry, i) => {
            const key = `${entry.at}-${i}`;
            const expanded = open === key;
            return (
              <li key={key} className="px-3 py-2">
                <button type="button" onClick={() => setOpen(expanded ? null : key)} aria-expanded={expanded} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
                  <span className="font-mono text-[11px] text-brand-mid-gray">{new Date(entry.at).toLocaleTimeString()}</span>
                  <span className="font-body text-xs font-semibold text-brand-dark-gray">{entry.source || "文字"}</span>
                  <span className="font-mono text-[11px] text-brand-mid-gray">{entry.model_id}</span>
                  <span className="font-body text-[11px] text-brand-mid-gray">{entry.chars.toLocaleString()} 个字符</span>
                  {entry.blocked ? (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">已拦截：{entry.leaks.map((l) => l.category).join("、")}</span>
                  ) : entry.tokens_present ? (
                    <span className="rounded-full bg-brand-teal/10 px-2 py-0.5 text-[10px] font-semibold text-brand-teal">仅包含代号</span>
                  ) : (
                    <span className="rounded-full bg-brand-light-gray-2 px-2 py-0.5 text-[10px] font-semibold text-brand-mid-gray">没有敏感信息</span>
                  )}
                </button>
                {expanded && (
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-brand-light-gray-2/60 p-2 font-mono text-[11px] leading-relaxed text-brand-dark-gray">{entry.prompt}{entry.truncated ? "\n[内容已截断]" : ""}</pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}`;
}

export default function PiiShieldCard({ onChanged }: { onChanged?: (status: PiiShieldStatus) => void }) {
  const [status, setStatus] = useState<PiiShieldStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const load = async () => {
    try {
      const next = await api.getPiiShield();
      setStatus(next);
      onChanged?.(next);
    } catch (err) {
      console.error("Failed to load PII Shield status", err);
      setError(err instanceof Error ? err.message : "无法加载个人信息保护状态。");
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While the model downloads, poll until it is ready or fails.
  const downloading = Boolean(status?.settings.enabled && status.settings.ner && status.ner.state === "downloading");
  useEffect(() => {
    if (!downloading) return;
    const id = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(id);
  }, [downloading]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async (update: Update) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.updatePiiShield(update);
      setStatus(next);
      onChanged?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法更新个人信息保护设置。");
    } finally {
      setSaving(false);
    }
  };

  const enabled = status?.settings.enabled ?? false;
  const toggleCategory = (id: PiiCategory) => {
    if (!status) return;
    const current = status.settings.categories;
    void apply({ categories: current.includes(id) ? current.filter((c) => c !== id) : [...current, id] });
  };

  return (
    <div className={`rounded-xl bg-surface p-5 shadow-sm transition-opacity ${saving ? "opacity-70" : ""} ${enabled ? "ring-1 ring-brand-teal" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-brand-dark-gray">个人信息保护</h3>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              enabled
                ? "border-teal-600 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-900 dark:text-teal-100"
                : "border-slate-500 bg-slate-700 text-slate-50"
            }`}>
              {enabled ? "个人信息已替换为代号" : "个人信息按原话保存"}
            </span>
          </div>
          <p className="mt-1 font-body text-xs leading-relaxed text-brand-gray">
            会把姓名、联系方式和各种编号替换为类似
            <span className="font-mono"> [PERSON_1]</span> 的代号，然后才保存或展示给本地、云端模型。真实内容会加密保存在这台电脑里，只会在你的屏幕上或你主动导出的文件中还原。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void apply({ enabled: !enabled })}
          disabled={!status || saving}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? "关闭个人信息保护" : "开启个人信息保护"}
          className={`h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${enabled ? "bg-brand-teal" : "bg-brand-light-gray-1"}`}
        >
          <span className={`block h-5 w-5 rounded-full bg-surface shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 font-body text-xs text-red-700">{error}</p>
      )}

      {status && <CoverageList status={status} />}

      {status && enabled && (
        <p className="mt-3 font-body text-[11px] text-brand-mid-gray">
          保险库：所有会议共有 {plural(status.vault.entries, "条受保护内容")}。
          过去 24 小时在屏幕上还原过：{plural(status.reveals_24h.tokens, "个代号")}，共 {plural(status.reveals_24h.requests, "次请求")}。
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        className="mt-3 inline-flex items-center gap-1.5 font-body text-xs font-semibold text-brand-teal hover:underline"
      >
        <svg className={`h-3 w-3 transition-transform ${showDetails ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {showDetails ? "隐藏" : "显示"}识别范围并试写一句话
      </button>

      {showDetails && status && (
        <div className="mt-4 space-y-5">
          <CategoryPicker status={status} saving={saving} onToggle={toggleCategory} />
          <NerSection status={status} saving={saving} onApply={(u) => void apply(u)} onReload={load} />
          <TermsSection settings={status.settings} saving={saving} onApply={(u) => void apply(u)} />
          <PreviewSection />
          <EgressSection settings={status.settings} saving={saving} onApply={(u) => void apply(u)} />
        </div>
      )}
    </div>
  );
}
