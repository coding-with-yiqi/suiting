import { useMemo } from "react";
import type { ModelPricingResponse, TokenUsageSummary } from "../../types";
import { estimateCostUsd, estimateSessionCostUsd, formatAudioDuration, formatEstimatedCost } from "../../lib/modelPricing";

interface TokenUsagePanelProps {
  tokenUsage: TokenUsageSummary | null;
  loading: boolean;
  error: boolean;
  pricing: ModelPricingResponse | null;
  onRefresh: () => void;
}

// The post-call Tokens tab: recorded usage and its estimated cost. The fetch
// lives in PostCallView because the Overview's cost tile shares it; this
// panel only renders what it is handed.
export default function TokenUsagePanel({ tokenUsage, loading, error, pricing, onRefresh }: TokenUsagePanelProps) {
  return (
    <div className="rounded-xl bg-surface p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-brand-dark-gray">令牌用量</h2>
          <p className="mt-1 text-sm text-brand-mid-gray">本场通话记录的模型用量。</p>
        </div>
        {!loading && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md border border-brand-light-gray-1 px-3 py-1.5 text-sm font-medium text-brand-teal hover:bg-brand-light-gray-2"
          >
            刷新
          </button>
        )}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-brand-mid-gray" role="status">正在加载用量…</p>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-700">无法加载用量。</p>
        </div>
      ) : tokenUsage ? (
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-brand-teal/20 bg-brand-teal/5 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray">预计费用</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-brand-dark-gray">
              {formatEstimatedCost(
                pricing ? estimateSessionCostUsd(tokenUsage.by_model, pricing.models) : null,
              )}
            </p>
            <p className="mt-2 text-sm text-brand-mid-gray">
              {tokenUsage.total_tokens.toLocaleString()} 个令牌
              {" ("}
              {tokenUsage.input_tokens.toLocaleString()} 输入 / {tokenUsage.output_tokens.toLocaleString()} 输出
              {tokenUsage.thinking_tokens > 0 && (
                <> / {tokenUsage.thinking_tokens.toLocaleString()} 思考</>
              )}
              {")"}
              {tokenUsage.audio_seconds > 0 && (
                <> 另外使用 {formatAudioDuration(tokenUsage.audio_seconds)} 音频</>
              )}
            </p>
            {tokenUsage.thinking_tokens > 0 && (
              <p className="mt-1 text-xs text-brand-mid-gray">
                思考令牌按输出价格计费。
              </p>
            )}
            {((tokenUsage.audio_input_tokens ?? 0) > 0 || (tokenUsage.audio_output_tokens ?? 0) > 0) && (
              <p className="mt-1 text-xs text-brand-mid-gray">
                其中 {(tokenUsage.audio_input_tokens ?? 0).toLocaleString()} 个输入令牌
                {(tokenUsage.audio_output_tokens ?? 0) > 0 && (
                  <>和 {(tokenUsage.audio_output_tokens ?? 0).toLocaleString()} 个输出令牌</>
                )}
                属于音频，按服务商公布的音频价格计费。
              </p>
            )}
            {(tokenUsage.cached_input_tokens ?? 0) > 0 && (
              <p className="mt-1 text-xs text-brand-mid-gray">
                {(tokenUsage.cached_input_tokens ?? 0).toLocaleString()} 个输入令牌来自服务商的提示词缓存，按缓存价格计费。
              </p>
            )}
            {tokenUsage.audio_seconds > 0 && (
              <p className="mt-1 text-xs text-brand-mid-gray">
                实时网关按音频分钟计费，而不是按令牌计费。
              </p>
            )}
          </div>

          {tokenUsage.total_tokens === 0 && tokenUsage.audio_seconds === 0 ? (
            <p className="text-sm text-brand-mid-gray">本场通话没有记录用量。</p>
          ) : (
            <>
              <TokenBreakdownTable title="按来源" rows={tokenUsage.by_source} showSource pricing={pricing} showRateNote={false} />
              <TokenBreakdownTable title="按模型" rows={tokenUsage.by_model} pricing={pricing} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TokenBreakdownTable({
  title,
  rows,
  showSource = false,
  pricing = null,
  showRateNote = true,
}: {
  title: string;
  rows: TokenUsageSummary["by_source"];
  showSource?: boolean;
  // When set, adds an Est. cost column plus a session total row.
  pricing?: ModelPricingResponse | null;
  // Both tables price their rows, but the rate caveat only needs saying once.
  showRateNote?: boolean;
}) {
  const sessionCost = pricing ? estimateSessionCostUsd(rows, pricing.models) : null;
  // The API orders by tokens, which ranks a duration-billed row (zero tokens,
  // real money) last. Cost is the only axis the two billing units share, and
  // it is only known here, so the re-sort happens at render.
  const ordered = useMemo(() => {
    if (!pricing) return rows;
    const cost = (row: TokenUsageSummary["by_source"][number]) =>
      estimateCostUsd(pricing.models[row.model_id], row) ?? -1;
    return [...rows].sort((a, b) => cost(b) - cost(a));
  }, [rows, pricing]);
  // Only surface the thinking column when something actually thought, so
  // non-reasoning sessions keep the narrower table. Same for audio duration,
  // which is non-zero only when a duration-billed model ran, and for the
  // cached and audio token slices, which most text-only sessions never see.
  const showThinking = rows.some((row) => row.thinking_tokens > 0);
  const showAudio = rows.some((row) => (row.audio_seconds ?? 0) > 0);
  const showCached = rows.some((row) => (row.cached_input_tokens ?? 0) > 0);
  const showAudioTokens = rows.some((row) => (row.audio_input_tokens ?? 0) > 0 || (row.audio_output_tokens ?? 0) > 0);
  const audioTokensCell = (row: TokenUsageSummary["by_source"][number]) => {
    const input = row.audio_input_tokens ?? 0;
    const output = row.audio_output_tokens ?? 0;
    if (input === 0 && output === 0) return "-";
    return output > 0 ? `${input.toLocaleString()} 输入 / ${output.toLocaleString()} 输出` : input.toLocaleString();
  };
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-gray">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-brand-light-gray-1">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-brand-light-gray-2 text-xs uppercase tracking-wide text-brand-gray">
            <tr>
              {showSource && <th scope="col" className="px-4 py-3 font-semibold">来源</th>}
              <th scope="col" className="px-4 py-3 font-semibold">模型</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">输入</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">输出</th>
              {showThinking && <th scope="col" className="px-4 py-3 text-right font-semibold">思考</th>}
              {showCached && <th scope="col" className="px-4 py-3 text-right font-semibold" title="来自服务商提示词缓存的输入令牌">缓存输入</th>}
              {showAudioTokens && <th scope="col" className="px-4 py-3 text-right font-semibold" title="服务商计为音频的令牌">音频令牌</th>}
              {showAudio && <th scope="col" className="px-4 py-3 text-right font-semibold">音频</th>}
              <th scope="col" className="px-4 py-3 text-right font-semibold">总计</th>
              {pricing && <th scope="col" className="px-4 py-3 text-right font-semibold">预计费用</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-light-gray-1">
            {ordered.map((row) => (
              <tr key={`${row.source ?? "model"}-${row.model_id}`}>
                {showSource && <th scope="row" className="px-4 py-3 font-medium text-brand-dark-gray">{row.source}</th>}
                <td className="px-4 py-3 font-mono text-xs text-brand-gray">{row.model_id}</td>
                <td className="px-4 py-3 text-right tabular-nums text-brand-gray">{row.input_tokens.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-brand-gray">{row.output_tokens.toLocaleString()}</td>
                {showThinking && (
                  <td className="px-4 py-3 text-right tabular-nums text-brand-gray">{row.thinking_tokens.toLocaleString()}</td>
                )}
                {showCached && (
                  <td className="px-4 py-3 text-right tabular-nums text-brand-gray">{(row.cached_input_tokens ?? 0) > 0 ? (row.cached_input_tokens ?? 0).toLocaleString() : "-"}</td>
                )}
                {showAudioTokens && (
                  <td className="px-4 py-3 text-right tabular-nums text-brand-gray">{audioTokensCell(row)}</td>
                )}
                {showAudio && (
                  <td className="px-4 py-3 text-right tabular-nums text-brand-gray">{formatAudioDuration(row.audio_seconds ?? 0)}</td>
                )}
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-dark-gray">{row.total_tokens.toLocaleString()}</td>
                {pricing && (
                  <td className="px-4 py-3 text-right tabular-nums text-brand-gray">
                    {formatEstimatedCost(estimateCostUsd(pricing.models[row.model_id], row))}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {pricing && (
            <tfoot className="border-t border-brand-light-gray-1 bg-brand-light-gray-2/60">
              <tr>
                <th scope="row" colSpan={(showSource ? 5 : 4) + (showThinking ? 1 : 0) + (showCached ? 1 : 0) + (showAudioTokens ? 1 : 0) + (showAudio ? 1 : 0)} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-brand-gray">
                  本场预计费用
                </th>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-dark-gray">
                  {formatEstimatedCost(sessionCost)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pricing && showRateNote && (
        <p className="mt-2 text-xs text-brand-mid-gray">
          预计费用按各服务商截至 {pricing.as_of} 的标准付费价格计算：缓存和音频令牌按服务商公布的对应价格计费（未公布时按普通文本价格），思考令牌按输出价格计费，按音频时长计费的模型按分钟计算。不包含长上下文附加费或缓存存储费。没有公开价格的模型显示“－”，且不计入总额。
        </p>
      )}
    </section>
  );
}
