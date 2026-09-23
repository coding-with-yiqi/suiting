import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type {
  CallSegment,
  ModelPricingResponse,
  Question,
  Session,
  SessionSynthesis,
  Speaker,
  TokenUsageSummary,
  TranscriptEntry,
} from "../../types";
import { estimateSessionCostUsd, formatEstimatedCost } from "../../lib/modelPricing";
import { DIVIDED_LIST_CLASS, SectionHeading, StatusText, meetingTypeLabel } from "./BriefingView";
import {
  callRhythm,
  commitments,
  headline,
  openLoops,
  opportunities,
  participation,
  risks,
  type Headline,
  type OverviewItem,
  type OverviewSection,
} from "./overviewMetrics";

// The Overview is the landing worksheet: one headline, one row of numbers,
// then the four lists set like the Briefing (small-caps headings on hairline
// rules, no boxes) and two measured panels. Every number links to the rows it
// counts, and every list footer says where the rest of the record lives.

// Where a section sends the reader for the raw record behind it. The Insights
// tab takes an optional type filter so a link lands on one group.
export type OverviewTarget =
  | { tab: "insights"; filter?: string }
  | { tab: "briefing" | "transcript" | "speakers" | "tokens" };

interface OverviewViewProps {
  session: Session;
  questions: Question[];
  transcripts: TranscriptEntry[];
  speakers: Speaker[];
  segments: CallSegment[];
  synthesis: SessionSynthesis | null;
  tokenUsage: TokenUsageSummary | null;
  tokenUsageLoading: boolean;
  tokenUsageError: boolean;
  modelPricing: ModelPricingResponse | null;
  onNavigate: (target: OverviewTarget) => void;
  // Offered only when the session has a transcript and no analysis at all.
  onAnalyze?: () => Promise<void>;
  analyzing?: boolean;
  analyzeError?: string | null;
}

// Middle dot, built from its code point so the source stays ASCII.
const SEPARATOR = String.fromCharCode(0xb7);

function Separator() {
  return (
    <span aria-hidden="true" className="mx-2 text-brand-light-gray-1">
      {SEPARATOR}
    </span>
  );
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  const labels: Record<string, (value: number) => string> = {
    "action item": (value) => `${value} 个待办事项`,
    question: (value) => `${value} 个问题`,
    opportunity: (value) => `${value} 个机会`,
    opportunities: (value) => `${value} 个机会`,
    "current strategic signal": (value) => `${value} 条当前战略信号`,
    insight: (value) => `${value} 条洞察`,
    speaker: (value) => `${value} 位说话人`,
  };
  return labels[singular]?.(count) || `${count} ${pluralForm}`;
}

// A quiet text link with an arrow and a 24px hit area: enough affordance to
// find, not so much that six of them compete with the page's one accent.
function Link({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-6 items-center gap-1 rounded text-xs font-medium text-brand-gray transition-colors hover:text-brand-dark-gray focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 font-body text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
    >
      {text}
    </p>
  );
}

// Same row as a Briefing item: title with status and owner on the title row,
// one line of detail beneath. Status goes through the Briefing's StatusText
// so "Blocked" and "Needs follow-up" read the same on both tabs.
function Row({ item }: { item: OverviewItem }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-[14rem] flex-1 text-pretty font-body text-sm font-semibold leading-snug text-brand-dark-gray">
          {item.title}
        </p>
        {(item.status || item.owner) && (
          <span className="flex shrink-0 flex-wrap items-center font-body text-xs text-brand-mid-gray">
            {item.status && <StatusText status={item.status} />}
            {item.status && item.owner && <Separator />}
            {item.owner && <span>{item.owner}</span>}
          </span>
        )}
      </div>
      {item.detail && (
        <p className="mt-1 line-clamp-2 max-w-prose font-body text-sm leading-relaxed text-brand-gray">{item.detail}</p>
      )}
    </li>
  );
}

interface ListSpec {
  key: string;
  label: string;
  section: OverviewSection;
  empty: string;
  // How the live-insight counterpart reads, given how many rows match and
  // how many the Insights filter shows in all.
  inInsights: (matching: number, shown: number) => string;
}

function ListSection({ spec, onNavigate }: { spec: ListSpec; onNavigate: (target: OverviewTarget) => void }) {
  const { section } = spec;
  const toInsights = () => onNavigate({ tab: "insights", filter: section.insights.filter });
  const footer: ReactNode[] = [];
  if (section.source === "briefing") {
    if (section.total > section.items.length) {
      footer.push(<Link key="all" label={`总结中的全部 ${section.total} 条`} onClick={() => onNavigate({ tab: "briefing" })} />);
    }
    if (section.insights.matching > 0) {
      footer.push(<Link key="live" label={spec.inInsights(section.insights.matching, section.insights.shown)} onClick={toInsights} />);
    } else {
      footer.push(<span key="none">实时过程中没有记录。</span>);
    }
  } else if (section.insights.matching > 0) {
    footer.push(<Link key="live" label={spec.inInsights(section.insights.matching, section.insights.shown)} onClick={toInsights} />);
  }
  return (
    <section>
      <SectionHeading label={spec.label} count={section.total} />
      {section.items.length === 0 ? (
        <p className="mt-3 font-body text-sm text-brand-mid-gray">{spec.empty}</p>
      ) : (
        <ul className={`mt-4 ${DIVIDED_LIST_CLASS}`}>
          {section.items.map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </ul>
      )}
      {footer.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-xs text-brand-mid-gray">{footer}</p>
      )}
    </section>
  );
}

// One tile per headline number. The first tile carries the page's single
// accent tint; the rest stay neutral so the eye lands on commitments first.
function StatTile({
  label,
  value,
  sub,
  primary = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${
        primary
          ? "border-brand-teal/30 bg-brand-teal/5 hover:bg-brand-teal/10"
          : "border-brand-light-gray-1 bg-surface hover:bg-brand-light-gray-2/60"
      }`}
    >
      <p className="text-xs font-medium text-brand-mid-gray">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums leading-none ${primary ? "text-brand-teal" : "text-brand-dark-gray"}`}>
        {value}
      </p>
      <p className="mt-1.5 truncate text-xs text-brand-mid-gray">{sub || "\u00a0"}</p>
    </button>
  );
}

function sectionTile(spec: ListSpec, primary: boolean, onNavigate: (target: OverviewTarget) => void) {
  const { section } = spec;
  return (
    <StatTile
      key={spec.key}
      label={spec.label}
      value={section.total}
      sub={section.source === "briefing" ? "来自通话总结" : "来自洞察"}
      primary={primary}
      onClick={() =>
        onNavigate(section.source === "briefing" ? { tab: "briefing" } : { tab: "insights", filter: section.insights.filter })
      }
    />
  );
}

function CostTile({
  tokenUsage,
  loading,
  pricing,
  onClick,
}: {
  tokenUsage: TokenUsageSummary | null;
  loading: boolean;
  pricing: ModelPricingResponse | null;
  onClick: () => void;
}) {
  if (loading) {
    return (
      <StatTile
        label="预计费用"
        value={<span className="inline-block h-6 w-14 animate-pulse rounded bg-brand-light-gray-2 motion-reduce:animate-none" role="img" aria-label="加载中" />}
        sub="正在加载用量"
        onClick={onClick}
      />
    );
  }
  const recorded = Boolean(tokenUsage && (tokenUsage.total_tokens > 0 || tokenUsage.audio_seconds > 0));
  const cost = tokenUsage && pricing && recorded ? estimateSessionCostUsd(tokenUsage.by_model, pricing.models) : null;
  const sub = !tokenUsage ? "无法获取用量" : !recorded ? "没有记录用量" : `${tokenUsage.total_tokens.toLocaleString()} 个令牌`;
  return <StatTile label="预计费用" value={formatEstimatedCost(cost)} sub={sub} onClick={onClick} />;
}

function ParticipationPanel({
  transcripts,
  speakers,
  onNavigate,
}: {
  transcripts: TranscriptEntry[];
  speakers: Speaker[];
  onNavigate: (target: OverviewTarget) => void;
}) {
  const rows = participation(transcripts, speakers);
  const shown = rows.slice(0, 8);
  const hidden = rows.length - shown.length;
  const headingId = "overview-participation";
  return (
    <section aria-labelledby={headingId} className="rounded-xl bg-surface p-5 shadow-sm">
      <SectionHeading id={headingId} label="参与情况" count={rows.length} />
      {rows.length === 0 ? (
        <p className="mt-3 font-body text-sm text-brand-mid-gray">没有转录文字可统计。</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`按字数计算的发言占比： ${rows.map((row) => `${row.name} ${percent(row.share)}`).join(", ")}`}
            className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-brand-light-gray-2"
          >
            {rows.map((row) => (
              <div
                key={row.speakerId ?? "unattributed"}
                className="h-full min-w-[2px]"
                style={{ width: `${row.share * 100}%`, backgroundColor: row.color }}
                title={`${row.name}: ${percent(row.share)}`}
              />
            ))}
          </div>
          <table className="mt-3 w-full font-body text-xs">
            <thead>
              <tr className="text-brand-mid-gray">
                <th scope="col" className="pb-1.5 text-left font-medium">说话人</th>
                <th scope="col" className="pb-1.5 text-right font-medium">占比</th>
                <th scope="col" className="pb-1.5 text-right font-medium">字数</th>
                <th scope="col" className="pb-1.5 text-right font-medium">发言次数</th>
              </tr>
            </thead>
            <tbody className={DIVIDED_LIST_CLASS}>
              {shown.map((row) => (
                <tr key={row.speakerId ?? "unattributed"}>
                  <th scope="row" className="py-1.5 text-left font-medium text-brand-dark-gray">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden="true" />
                      <span className="truncate">{row.name}</span>
                    </span>
                  </th>
                  <td className="py-1.5 text-right tabular-nums text-brand-dark-gray">{percent(row.share)}</td>
                  <td className="py-1.5 text-right tabular-nums text-brand-gray">{row.words.toLocaleString()}</td>
                  <td className="py-1.5 text-right tabular-nums text-brand-gray">{row.turns.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 font-body text-xs text-brand-mid-gray">
            {hidden > 0 && <span>{hidden} 条未显示。</span>}
            <Link label="说话人" onClick={() => onNavigate({ tab: "speakers" })} />
          </p>
        </>
      )}
    </section>
  );
}

const BAR_W = 6;
const BAR_GAP = 2;
const CHART_H = 40;

function RhythmPanel({
  questions,
  session,
  segments,
  transcripts,
  onNavigate,
}: {
  questions: Question[];
  session: Session;
  segments: CallSegment[];
  transcripts: TranscriptEntry[];
  onNavigate: (target: OverviewTarget) => void;
}) {
  const rhythm = callRhythm(questions, session, segments, transcripts);
  if (!rhythm) return null;
  const { buckets, breaks, busiest, peak, total, bucketMs } = rhythm;
  const minutesAt = (index: number) => Math.round((index * bucketMs) / 60000);
  const unit = BAR_W + BAR_GAP;
  const width = buckets.length * unit - BAR_GAP;
  const endMinutes = minutesAt(buckets.length);
  const midMinutes = minutesAt(Math.floor(buckets.length / 2));
  const headingId = "overview-rhythm";
  const summary = `${total} 条洞察，通话持续 ${endMinutes} 分钟；最活跃时段为 ${minutesAt(busiest)} 至 ${minutesAt(busiest + 1)} 分钟，有 ${peak} 条洞察。`;
  return (
    <section aria-labelledby={headingId} className="rounded-xl bg-surface p-5 shadow-sm">
      <SectionHeading id={headingId} label="通话节奏" count={total} />
      <svg
        viewBox={`0 0 ${width} ${CHART_H}`}
        preserveAspectRatio="none"
        className="mt-4 h-16 w-full text-brand-teal"
        role="img"
        aria-label={`每五分钟产生的洞察数量。 ${summary}`}
      >
        {buckets.map((bucket, index) => {
          const h = peak > 0 ? Math.max(bucket.count > 0 ? 1 : 0, (bucket.count / peak) * CHART_H) : 0;
          return (
            <g key={bucket.startMs}>
              <title>{`${minutesAt(index)}-${minutesAt(index + 1)} min: ${plural(bucket.count, "insight")}`}</title>
              <rect
                x={index * unit}
                y={CHART_H - h}
                width={BAR_W}
                height={h}
                fill="currentColor"
                fillOpacity={index === busiest ? 1 : 0.35}
              />
            </g>
          );
        })}
        {breaks.map((offsetMs) => {
          // A resume: the call paused here, so the axis shows a seam rather
          // than the hours that passed on the wall clock.
          const x = (offsetMs / bucketMs) * unit - BAR_GAP / 2;
          return (
            <line
              key={offsetMs}
              x1={x}
              x2={x}
              y1={0}
              y2={CHART_H}
              stroke="currentColor"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          );
        })}
        <line x1={0} x2={width} y1={CHART_H - 0.25} y2={CHART_H - 0.25} stroke="currentColor" strokeOpacity={0.25} strokeWidth={0.5} />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-brand-mid-gray" aria-hidden="true">
        <span>0 分钟</span>
        <span>{midMinutes} 分钟</span>
        <span>{endMinutes} 分钟</span>
      </div>
      <p className="mt-2 font-body text-xs text-brand-gray">
        最活跃时段 {minutesAt(busiest)}-{minutesAt(busiest + 1)} 分钟，有 {plural(peak, "insight")}。
        {rhythm.segments > 1 && ` 通话分为 ${rhythm.segments} 段，虚线表示重新接通。`}
      </p>
      <p className="mt-2 flex font-body text-xs text-brand-mid-gray">
        <Link label="转录" onClick={() => onNavigate({ tab: "transcript" })} />
      </p>
    </section>
  );
}

// The four lists, in reading order, with the wording each footer uses for its
// live-insight counterpart.
function buildSpecs(questions: Question[], synthesis: SessionSynthesis | null): ListSpec[] {
  return [
    {
      key: "commitments",
      label: "待办承诺",
      section: commitments(questions, synthesis),
      empty: "没有记录待办事项或计划步骤。",
      inInsights: (matching) => `${plural(matching, "action item")}中的洞察`,
    },
    {
      key: "open",
      label: "未解决问题",
      section: openLoops(questions, synthesis),
      empty: "记录的问题都已得到回答。",
      inInsights: (matching, shown) => `${matching} 个未解决问题，共 ${plural(shown, "question")}`,
    },
    {
      key: "opportunities",
      label: "机会",
      section: opportunities(questions, synthesis),
      empty: "本次对话没有发现机会。",
      inInsights: (matching) => `${plural(matching, "opportunity", "opportunities")}中的洞察`,
    },
    {
      key: "risks",
      label: "风险",
      section: risks(questions, synthesis),
      empty: "没有发现风险或阻碍。",
      inInsights: (matching, shown) => `${matching} 条，共 ${plural(shown, "current strategic signal")}`,
    },
  ];
}

function HeadlineSection({
  session,
  speakers,
  lead,
  hasBriefing,
  onNavigate,
}: {
  session: Session;
  speakers: Speaker[];
  lead: Headline;
  hasBriefing: boolean;
  onNavigate: (target: OverviewTarget) => void;
}) {
  const meta = [meetingTypeLabel(session.meeting_type), speakers.length ? plural(speakers.length, "speaker") : ""].filter(Boolean);
  const readBriefing = <Link label="查看通话总结" onClick={() => onNavigate({ tab: "briefing" })} />;
  return (
    <section aria-labelledby="overview-headline" className="rounded-xl bg-surface p-6 shadow-sm">
      {meta.length > 0 && (
        <p className="flex flex-wrap items-center font-body text-xs text-brand-mid-gray">
          {meta.map((part, index) => (
            <span key={part} className="inline-flex items-center">
              {index > 0 && <Separator />}
              {part}
            </span>
          ))}
        </p>
      )}
      <h2 id="overview-headline" className="mt-2 text-balance font-display text-xl font-semibold leading-snug tracking-tight text-brand-dark-gray">
        {lead.text}
      </h2>
      {lead.detail && <p className="mt-1.5 max-w-prose font-body text-sm leading-relaxed text-brand-gray">{lead.detail}</p>}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs text-brand-mid-gray">
        {lead.source === "briefing" ? (
          <>
            <span>总结中的首要结果。</span>
            {readBriefing}
          </>
        ) : hasBriefing ? (
          <>
            <span>总结中没有记录首要结果。</span>
            {readBriefing}
          </>
        ) : (
          <span>以下数据来自已记录内容；尚未生成通话总结。</span>
        )}
      </p>
    </section>
  );
}

function UnanalyzedCard({
  hasTranscript,
  onAnalyze,
  analyzing,
}: {
  hasTranscript: boolean;
  onAnalyze?: () => Promise<void>;
  analyzing: boolean;
}) {
  return (
    <section aria-labelledby="overview-unanalyzed" className="rounded-xl border border-dashed border-brand-light-gray-1 bg-surface p-6">
      <h3 id="overview-unanalyzed" className="font-display text-sm font-semibold text-brand-dark-gray">还没有分析内容</h3>
      {hasTranscript ? (
        <>
          <p className="mt-1 max-w-prose font-body text-sm text-brand-gray">
            转录已保存，但还没有洞察或总结。现在分析即可填充本页，也可以到“通话总结”页生成。
          </p>
          {onAnalyze && (
            <button
              type="button"
              onClick={() => void onAnalyze()}
              disabled={analyzing}
              className="mt-3 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-teal-dark disabled:cursor-wait disabled:bg-brand-mid-gray"
            >
              {analyzing ? "正在分析…" : "分析转录"}
            </button>
          )}
        </>
      ) : (
        <p className="mt-1 max-w-prose font-body text-sm text-brand-gray">
          也没有记录转录。请继续通话来采集音频，或从新通话导入转录。
        </p>
      )}
    </section>
  );
}

// The numbers row and the sheet of lists beneath it.
function SummaryBlock({
  specs,
  tokenUsage,
  tokenUsageLoading,
  tokenUsageError,
  modelPricing,
  onNavigate,
}: {
  specs: ListSpec[];
  tokenUsage: TokenUsageSummary | null;
  tokenUsageLoading: boolean;
  tokenUsageError: boolean;
  modelPricing: ModelPricingResponse | null;
  onNavigate: (target: OverviewTarget) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {specs.map((spec, index) => sectionTile(spec, index === 0, onNavigate))}
        <CostTile
          tokenUsage={tokenUsageError ? null : tokenUsage}
          loading={tokenUsageLoading}
          pricing={modelPricing}
          onClick={() => onNavigate({ tab: "tokens" })}
        />
      </div>

      <article className="rounded-xl bg-surface px-5 py-6 shadow-sm sm:px-8">
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          {specs.map((spec) => (
            <ListSection key={spec.key} spec={spec} onNavigate={onNavigate} />
          ))}
        </div>
      </article>
    </>
  );
}

export default function OverviewView({
  session,
  questions,
  transcripts,
  speakers,
  segments,
  synthesis,
  tokenUsage,
  tokenUsageLoading,
  tokenUsageError,
  modelPricing,
  onNavigate,
  onAnalyze,
  analyzing = false,
  analyzeError = null,
}: OverviewViewProps) {
  const lead = headline(session, synthesis, questions, speakers, segments, transcripts);
  // Raw count, dismissed rows included: a session whose every insight was
  // dismissed has been analyzed, and analyzing it again would append duplicates.
  const nothingAnalyzed = questions.length === 0 && !synthesis;

  return (
    <div className="space-y-6">
      <HeadlineSection session={session} speakers={speakers} lead={lead} hasBriefing={Boolean(synthesis)} onNavigate={onNavigate} />

      {analyzeError && <ErrorNote text={analyzeError} />}

      {nothingAnalyzed ? (
        <UnanalyzedCard hasTranscript={transcripts.length > 0} onAnalyze={onAnalyze} analyzing={analyzing} />
      ) : (
        <SummaryBlock
          specs={buildSpecs(questions, synthesis)}
          tokenUsage={tokenUsage}
          tokenUsageLoading={tokenUsageLoading}
          tokenUsageError={tokenUsageError}
          modelPricing={modelPricing}
          onNavigate={onNavigate}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ParticipationPanel transcripts={transcripts} speakers={speakers} onNavigate={onNavigate} />
        <RhythmPanel questions={questions} session={session} segments={segments} transcripts={transcripts} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
