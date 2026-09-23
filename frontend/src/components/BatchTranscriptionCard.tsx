import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelInfo, TranscriptionConfig } from "../types";
import * as api from "../services/api";
import { groupModels, optionLabel, optionState, runsLocally } from "../lib/modelOptions";

interface BatchTranscriptionCardProps {
  models: ModelInfo[];
  localOnly?: boolean;
  // Names the switch behind localOnly: Privacy First or the PII Shield.
  lockLabel?: string;
  /** Called after the live preview model changes; it edits the Audio Gateway agent's model. */
  onLiveModelChanged?: () => void;
  /** Audio Gateway agent's current model (same underlying setting as the live
      preview model); changing it on the Agents tab triggers a refetch here. */
  gatewayModelId?: string;
}

export default function BatchTranscriptionCard({ models, localOnly = false, lockLabel = "隐私优先", onLiveModelChanged, gatewayModelId }: BatchTranscriptionCardProps) {
  const [config, setConfig] = useState<TranscriptionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await api.getTranscriptionConfig());
      setError(null);
    } catch (err) {
      console.error("Failed to load transcription config", err);
      setError("无法加载转文字设置。");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload when Privacy First flips (the backend coerces the effective batch
  // model to a local one) or when the Audio Bridge model is edited on the
  // Agents tab (it is the same row as the live preview model shown here).
  useEffect(() => { void load(); }, [load, localOnly, gatewayModelId]);

  const batchModels = useMemo(
    () => models.filter((model) => model.supports_batch_audio),
    [models]
  );
  const liveModels = useMemo(
    () => models.filter((model) => model.supports_live_audio),
    [models]
  );

  const selectedModel = batchModels.find((model) => model.id === config?.batch_model_id);
  const liveModel = liveModels.find((model) => model.id === config?.live_preview_model_id);
  // Under Privacy First a local live model (the experimental on-device captioner)
  // is still usable; only a cloud gateway is off.
  const liveIsLocal = liveModel ? runsLocally(liveModel) : false;
  const livePreviewOff = Boolean(config?.live_preview_model_id && localOnly && !liveIsLocal);
  const hasLocalLiveModel = liveModels.some((model) => runsLocally(model));

  const update = async (data: { batch_model_id?: string; live_preview_model_id?: string }) => {
    setSaving(true);
    try {
      setConfig(await api.updateTranscriptionConfig(data));
      setError(null);
      if (data.live_preview_model_id !== undefined) onLiveModelChanged?.();
    } catch (err) {
      console.error("Failed to update transcription config", err);
      setError(err instanceof Error ? err.message : "无法更新转文字模型。");
    } finally {
      setSaving(false);
    }
  };

  const renderOptions = (
    available: ModelInfo[],
    currentId: string | undefined,
    role: "batch_transcription" | "audio_gateway",
  ) => (
    <>
      <option value="">未选择</option>
      {groupModels(available).map((group) => (
        <optgroup key={group.provider} label={group.provider}>
          {group.models.map((model) => {
            const { locked, suffix } = optionState(model, currentId, localOnly, lockLabel);
            return (
              <option key={model.id} value={model.id} disabled={locked}>
                {optionLabel(model, role)}{suffix}
              </option>
            );
          })}
        </optgroup>
      ))}
    </>
  );

  return (
    <div className={`rounded-xl bg-surface p-5 shadow-sm transition-opacity ${saving ? "opacity-70" : ""}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-brand-dark-gray">批量转文字</h3>
            <span className="inline-flex rounded-full border border-slate-500 bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-50">
              最终文字
            </span>
          </div>
          <p className="mt-1 font-body text-xs leading-relaxed text-brand-gray">
            决定如何把导入的声音和实时会议中已经区分好说话人的片段，转换成保存下来的文字。
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading || saving}
          className="rounded border border-brand-light-gray-1 px-3 py-1.5 font-body text-xs text-brand-dark-gray transition-colors hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "检查中……" : "刷新"}
        </button>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 p-3">
          <p className="font-body text-[10px] uppercase text-brand-mid-gray">批量转文字模型</p>
          <p className="mt-1 truncate font-display text-sm font-bold text-brand-dark-gray" title={config?.batch_model_id ?? ""}>
            {selectedModel?.name || config?.batch_model_id || "未选择"}
          </p>
          <p className="mt-1 truncate font-mono text-[10px] text-brand-mid-gray">{config?.batch_model_id}</p>
        </div>
        <div className="rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 p-3">
          <p className="font-body text-[10px] uppercase text-brand-mid-gray">实时预览模型</p>
          <p className="mt-1 truncate font-display text-sm font-bold text-brand-dark-gray" title={config?.live_preview_model_id ?? ""}>
            {livePreviewOff ? "已关闭（隐私优先）" : liveModel?.name || config?.live_preview_model_id || "未选择"}
          </p>
          <p className="mt-1 truncate font-mono text-[10px] text-brand-mid-gray">{config?.live_preview_model_id}</p>
        </div>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block font-body text-xs font-medium text-brand-gray">批量转文字模型</label>
          <select
            value={config?.batch_model_id ?? ""}
            disabled={!config || saving}
            onChange={(event) => void update({ batch_model_id: event.target.value })}
            className="w-full rounded border border-brand-light-gray-1 bg-surface px-3 py-1.5 text-sm text-brand-dark-gray transition-colors focus:border-brand-teal disabled:cursor-not-allowed disabled:bg-brand-light-gray-2"
          >
            {renderOptions(batchModels, config?.batch_model_id, "batch_transcription")}
          </select>
        </div>
        <div>
          <label className="mb-1 block font-body text-xs font-medium text-brand-gray">实时预览（临时字幕）模型</label>
          <select
            value={config?.live_preview_model_id ?? ""}
            disabled={!config || saving}
            onChange={(event) => void update({ live_preview_model_id: event.target.value })}
            className="w-full rounded border border-brand-light-gray-1 bg-surface px-3 py-1.5 text-sm text-brand-dark-gray transition-colors focus:border-brand-teal disabled:cursor-not-allowed disabled:bg-brand-light-gray-2"
          >
            {renderOptions(liveModels, config?.live_preview_model_id, "audio_gateway")}
          </select>
        </div>
      </div>

      {localOnly && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 font-body text-xs text-amber-900">
          {lockLabel === "隐私优先" ? "隐私优先模式" : "个人信息保护"}已开启：只能使用本地 ONNX 模型转文字。云端实时字幕连接器已关闭，
          但可以在这里选择实验性的本机字幕功能（{hasLocalLiveModel ? "Parakeet Live" : "有可用模型时"}）。
          它比较占用电脑处理器，建议先运行测试确认电脑带得动。
          关闭这个开关后，之前选择的云端模型会恢复。
        </p>
      )}

      <div className="rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 px-3 py-2">
        <p className="font-body text-xs leading-relaxed text-brand-gray">
          批量转文字会在系统区分好每段声音属于谁之后运行，并生成可以保存的会议文字。实时预览是另一套功能：声音连接器（Gemini Live 或 OpenAI Realtime，
          取决于你选择的模型）只在会议进行时显示临时字幕。在这里更换实时预览模型，也会同时更换“分析助手”页面里的声音连接器模型。
          自己电脑上的模型服务（兼容 OpenAI 的聊天模型）只能处理文字，因此不会列在这里；如果要完全离线转文字，请选择本地 ONNX 模型
          （local-whisper-base 或 local-parakeet），再给分析助手选择一个自己电脑上的聊天模型。
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 font-body text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}
