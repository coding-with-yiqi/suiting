import { useEffect, useMemo, useState } from "react";
import type {
  AgentActivityRecord,
  AgentActivitySnapshot,
} from "../../types";
import { agentDisplayName } from "../../utils/agentLabels";

export function isRunningLate(
  agent: AgentActivityRecord,
  now = Date.now(),
): boolean {
  if (
    agent.trigger !== "interval"
    || agent.state !== "waiting"
    || !agent.interval_seconds
    || !agent.next_due_at
  ) return false;
  const due = Date.parse(agent.next_due_at);
  return Number.isFinite(due)
    && now > due + agent.interval_seconds * 1000;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
}

function countdown(at: string | null, now: number): string {
  if (!at) return "-";
  const value = Date.parse(at);
  if (!Number.isFinite(value)) return "-";
  const seconds = Math.ceil((value - now) / 1000);
  return seconds > 0 ? duration(seconds) : "现在该运行";
}

function relativeTime(at: string | null, now: number): string {
  if (!at) return "从未运行";
  const value = Date.parse(at);
  if (!Number.isFinite(value)) return "从未运行";
  return `${duration(Math.max(0, Math.floor((now - value) / 1000)))}前`;
}

function stateLabel(state: AgentActivityRecord["state"]): string {
  return {
    running: "运行中",
    waiting: "等待中",
    blocked: "已阻塞",
    off: "已关闭",
    failing: "失败",
  }[state];
}

function displayAgentName(agent: Pick<AgentActivityRecord, "slug" | "name">): string {
  return agentDisplayName(agent.slug, agent.name);
}

function gatewayLabel(state: "ok" | "reconnecting" | "off"): string {
  return { ok: "正常", reconnecting: "正在重连", off: "已关闭" }[state];
}

function blockedReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    meeting_type: "会议类型不支持",
    no_model: "未选择模型",
    privacy_first: "隐私优先",
    pii_shield: "个人信息保护",
  };
  return labels[reason] || reason.replace(/_/g, " ");
}

export function activityEmptyMessage(
  snapshot: Pick<AgentActivitySnapshot, "agents" | "call"> | null,
  hasInsights: boolean,
  now = Date.now(),
): string | undefined {
  if (
    !snapshot
    || snapshot.call.degraded
    || snapshot.agents.some((agent) =>
      agent.state === "failing"
      || (agent.state === "blocked" && agent.blocked_reason !== "meeting_type")
    )
  ) return undefined;

  const candidates = snapshot.agents.filter((agent) =>
    agent.enabled
    && agent.trigger === "interval"
    && agent.state === "waiting"
    && agent.next_due_at
    && agent.slug !== "strategic_signals"
  );
  const agent = candidates.find((item) => item.slug === "consolidated_analyst")
    || candidates.sort(
      (a, b) => Date.parse(a.next_due_at || "") - Date.parse(b.next_due_at || ""),
    )[0];
  if (!agent?.interval_seconds || !agent.next_due_at) return undefined;

  const next = countdown(agent.next_due_at, now);
  if (!hasInsights && agent.counts.runs === 0) {
    return (
      `分析助手正在监听。${displayAgentName(agent)}每隔`
      + `${duration(agent.interval_seconds)}检查一次，预计约 ${next} 后出现第一批洞察。`
    );
  }
  return (
    `分析助手正在监听。${displayAgentName(agent)}每隔`
    + `${duration(agent.interval_seconds)}检查一次，距离下次检查还有 ${next}。`
  );
}

function nextLabel(agent: AgentActivityRecord, now: number): string {
  if (isRunningLate(agent, now)) return "运行延迟";
  if (agent.trigger === "event") return "事件触发";
  if (agent.trigger === "stream") return stateLabel(agent.state);
  if (agent.trigger === "post_call") return "通话结束时";
  return `下次：${countdown(agent.next_due_at, now)}`;
}

function StatChip({
  value,
  label,
  tone = "neutral",
}: {
  value: number;
  label: string;
  tone?: "neutral" | "warn" | "bad";
}) {
  const tones = {
    neutral: "bg-brand-light-gray-2 text-brand-gray",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-red-100 text-red-700",
  };
  // A zero is not news. "0 blocked, 0 late, 0 失败" is the normal state of a
  // healthy call, and printing it costs a row of the call screen to say nothing.
  if (value === 0) return null;
  return (
    <span
      className={`flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 font-body text-xs ${tones[tone]}`}
    >
      <span className="font-mono font-semibold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

// Summary counts for the collapsed row; the expanded table keeps the
// per-agent detail. Exported for tests.
export function summarizeAgents(agents: AgentActivityRecord[], now: number) {
  const analyst = agents.find((agent) => agent.slug === "consolidated_analyst");
  return {
    active: agents.filter(
      (agent) => agent.state === "running" || agent.state === "waiting",
    ).length,
    anyRunning: agents.some((agent) => agent.state === "running"),
    lenses:
      analyst && analyst.lens_count != null
      && (analyst.state === "running" || analyst.state === "waiting")
        ? analyst.lens_count
        : null,
    runs: agents.reduce((sum, agent) => sum + agent.counts.runs, 0),
    productive: agents.reduce(
      (sum, agent) => sum + (agent.counts.productive ?? 0),
      0,
    ),
    needSetup: agents.filter(
      (agent) => agent.state === "blocked" && agent.blocked_reason === "no_model",
    ).length,
    // Privacy First and missing-model states keep dedicated chips.
    blocked: agents.filter(
      (agent) =>
        agent.state === "blocked"
        && agent.blocked_reason !== "privacy_first"
        && agent.blocked_reason !== "pii_shield"
        && agent.blocked_reason !== "no_model",
    ).length,
    // Current state, not history: a transient error that the agent recovered
    // from must not read as an ongoing failure for the rest of the call.
    failed: agents.filter((agent) => agent.state === "failing").length,
    late: agents.filter((agent) => isRunningLate(agent, now)).length,
  };
}

export default function AgentActivityPanel({
  snapshot,
}: {
  snapshot: AgentActivitySnapshot | null;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo(
    () => summarizeAgents(snapshot?.agents || [], now),
    [snapshot, now],
  );
  const privacyBlocked = snapshot?.agents.filter(
    (agent) => agent.blocked_reason === "privacy_first",
  ).length || 0;
  const shieldBlocked = snapshot?.agents.filter(
    (agent) => agent.blocked_reason === "pii_shield",
  ).length || 0;

  return (
    <section className="border-b border-brand-light-gray-1 bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="agent-activity-details"
        className="flex w-full items-center gap-2 overflow-x-auto px-4 py-2 text-left md:px-6"
      >
        <span className="flex-shrink-0 font-body text-[10px] font-semibold uppercase tracking-wide text-brand-mid-gray">
          助手运行情况
        </span>
        {!snapshot ? (
          <span className="flex-shrink-0 rounded-full bg-brand-light-gray-2 px-2 py-1 font-body text-xs text-brand-mid-gray">
            正在连接…
          </span>
        ) : (
          <>
            <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-brand-light-gray-2 px-2 py-1 font-body text-xs text-brand-gray">
              <span
                className={`h-2 w-2 rounded-full ${
                  stats.anyRunning ? "animate-pulse bg-emerald-500" : "bg-brand-mid-gray"
                }`}
              />
              <span className="font-mono font-semibold tabular-nums">{stats.active}</span>
              个助手
            </span>
            {stats.lenses != null && <StatChip value={stats.lenses} label="个分析视角" />}
            <StatChip value={stats.runs} label="次运行" />
            <StatChip value={stats.productive} label="有洞察" />
            <StatChip value={stats.needSetup} label="需要设置" tone="warn" />
            <StatChip value={stats.blocked} label="已阻塞" tone="warn" />
            <StatChip value={stats.late} label="延迟" tone="warn" />
            <StatChip value={stats.failed} label="失败" tone="bad" />
          </>
        )}
        {privacyBlocked > 0 && (
          <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-1 font-body text-xs font-medium text-amber-800">
            {privacyBlocked} 个助手已关闭：隐私优先
          </span>
        )}
        {shieldBlocked > 0 && (
          <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-1 font-body text-xs font-medium text-amber-800">
            实时字幕已关闭：个人信息保护
          </span>
        )}
        <span className="ml-auto flex-shrink-0 text-brand-mid-gray" aria-hidden="true">
          {open ? "-" : "+"}
        </span>
      </button>

      {open && snapshot && (
        <div id="agent-activity-details" className="overflow-x-auto border-t border-brand-light-gray-1 px-4 py-3 md:px-6">
          <table className="w-full min-w-[900px] text-left font-body text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-brand-mid-gray">
              <tr>
                <th className="pb-2 pr-3">助手</th>
                <th className="pb-2 pr-3">状态</th>
                <th className="pb-2 pr-3">原因</th>
                <th className="pb-2 pr-3">上次运行</th>
                <th className="pb-2 pr-3">下次</th>
                <th className="pb-2 pr-3">上次结果</th>
                <th className="pb-2">上次失败</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-light-gray-1 text-brand-gray">
              {snapshot.agents.map((agent) => (
                <tr key={agent.slug} className="align-top">
                  <td className="py-2 pr-3 font-semibold text-brand-dark-gray">{displayAgentName(agent)}</td>
                  <td className="py-2 pr-3">{stateLabel(agent.state)}</td>
                  <td className="max-w-64 py-2 pr-3">
                    {agent.blocked_reason
                      ? `${blockedReasonLabel(agent.blocked_reason)}。${agent.remedy}`
                      : "-"}
                  </td>
                  <td className="py-2 pr-3">
                    {relativeTime(agent.last_run_started_at, now)}
                    {agent.last_run_ms !== null ? ` (${agent.last_run_ms}ms)` : ""}
                  </td>
                  <td className="py-2 pr-3">{nextLabel(agent, now)}</td>
                  <td className="max-w-72 py-2 pr-3">
                    {agent.last_outcome?.detail || "-"}
                  </td>
                  <td className="max-w-72 py-2">
                    {agent.last_error
                      ? `${agent.last_error.detail} ${agent.last_error.remedy}`
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 border-t border-brand-light-gray-1 pt-3 font-body text-xs text-brand-mid-gray">
            网关： {gatewayLabel(snapshot.call.gateway.state)}
            {" | "}转录： {snapshot.call.transcription.jobs} 个任务，{snapshot.call.transcription.failed} 失败
            {" | "}说话人处理： {snapshot.call.diarization.queued} 个排队，{snapshot.call.diarization.shed} 个已跳过
          </p>
        </div>
      )}
    </section>
  );
}
