import type { SignalHistoryItem } from "../types";

const SECTION_LABELS: Record<string, string> = {
  strategic_signals: "信号",
  risks_blockers: "风险 / 阻碍",
  unresolved_discovery_questions: "待回答的问题",
  top_opportunities: "机会",
  action_plan: "行动",
};

export function signalSectionLabel(section: string): string {
  return SECTION_LABELS[section] || (section || "signal").replace(/_/g, " ");
}

export function signalKey(item: SignalHistoryItem, index = 0): string {
  return `${item.section}:${item.title}:${item.first_seen}:${index}`;
}

function historyTime(value: string): string {
  const time = new Date(value);
  return Number.isFinite(time.getTime())
    ? time.toLocaleString([], { dateStyle: "short", timeStyle: "short" })
    : "未知";
}

/**
 * One captured strategic signal. Shared by the post-call history panel and the
 * live call view's Strategic insight filter so both read the same way.
 */
export default function StrategicSignalCard({ item }: { item: SignalHistoryItem }) {
  const title = item.title?.trim() || item.summary?.trim() || "未命名信号";
  const summary = item.summary?.trim() || "";
  const distinctSummary = Boolean(item.title?.trim() && summary);

  return (
    <article className="rounded-lg border border-brand-light-gray-1 bg-surface px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-brand-teal/10 px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-brand-teal">
          {signalSectionLabel(item.section)}
        </span>
        <span className="font-body text-[11px] font-medium text-brand-mid-gray">
          {item.count === 1 ? "出现过 1 次" : `出现过 ${item.count} 次`}
        </span>
      </div>
      <h4 className="mt-2 font-body text-sm font-semibold text-brand-dark-gray">{title}</h4>
      {distinctSummary && (
        <p className="mt-1 font-body text-xs leading-relaxed text-brand-gray">{summary}</p>
      )}
      {item.rationale?.trim() && (
        <p className="mt-2 font-body text-xs leading-relaxed text-brand-mid-gray">{item.rationale}</p>
      )}
      <p className="mt-2 font-body text-[11px] text-brand-mid-gray">
        首次出现：{historyTime(item.first_seen)} · 最近出现：{historyTime(item.last_seen)}
      </p>
    </article>
  );
}
