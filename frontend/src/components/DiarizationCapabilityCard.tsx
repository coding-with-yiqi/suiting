import { useCallback, useEffect, useRef, useState } from "react";
import type { DiarizationBenchmarkResult, DiarizationDiagnostics } from "../types";
import * as api from "../services/api";
import { useConfirm } from "./ConfirmProvider";
import { MIC_ONLY_AUDIO_CONSTRAINTS } from "../hooks/useAudioCapture";

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];
// Mirrors backend MIN/MAX_BENCHMARK_SECONDS: one 15s live Sortformer window
// plus 5s of slack, after which recording stops and validation runs.
const MIN_BENCHMARK_SECONDS = 15;
const MAX_RECORDING_SECONDS = MIN_BENCHMARK_SECONDS + 5;
const MAX_VOICE_RECORDING_SECONDS = 10;
type RecordingMode = "benchmark" | "voice";

export default function DiarizationCapabilityCard() {
  const [diarization, setDiarization] = useState<DiarizationDiagnostics | null>(null);
  const [benchmark, setBenchmark] = useState<DiarizationBenchmarkResult | null>(null);
  const [benchmarkFile, setBenchmarkFile] = useState<File | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceEnrolled, setVoiceEnrolled] = useState<boolean | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true);
  const [savingSelection, setSavingSelection] = useState(false);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(0.72);
  const [infoOpen, setInfoOpen] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordingGenerationRef = useRef(0);
  const { confirm } = useConfirm();

  const load = useCallback(async () => {
    setLoadingDiagnostics(true);
    try {
      const [result, voiceProfile] = await Promise.all([
        api.getDiarizationDiagnostics(),
        api.getVoiceProfileStatus(),
      ]);
      setDiarization(result);
      setVoiceEnrolled(voiceProfile.enrolled);
      setDiagnosticError(null);
    } catch (err) {
      console.error("Failed to load diarization diagnostics", err);
      setDiagnosticError("无法加载检测结果，后台服务可能还在启动。");
    } finally {
      setLoadingDiagnostics(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (diarization) {
      setThresholdDraft(diarization.speaker_similarity_threshold);
    }
  }, [diarization?.speaker_similarity_threshold]);

  useEffect(() => {
    if (!diagnosticError || diarization) {
      return;
    }

    const retry = window.setTimeout(() => {
      void load();
    }, 3000);

    return () => window.clearTimeout(retry);
  }, [diagnosticError, diarization, load]);

  const clearRecordingTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopMediaTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => {
    recordingGenerationRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state === "recording") recorder.stop();
    }
    clearRecordingTimer();
    stopMediaTracks();
  }, [clearRecordingTimer, stopMediaTracks]);

  const runBenchmark = async (file: File) => {
    setBenchmarking(true);
    setDiagnosticError(null);
    try {
      const result = await api.runSortformerBenchmark(file);
      setBenchmark(result);
      await load();
    } catch (err) {
      console.error("基准测试失败", err);
      setDiagnosticError(err instanceof Error ? err.message : "基准测试失败。 ");
    } finally {
      setBenchmarking(false);
    }
  };

  const handleUploadedBenchmark = () => {
    if (benchmarkFile) {
      void runBenchmark(benchmarkFile);
    }
  };

  const saveVoiceProfile = async (file: File) => {
    setVoiceSaving(true);
    setDiagnosticError(null);
    try {
      const result = await api.replaceVoiceProfile(file);
      setVoiceEnrolled(result.enrolled);
    } catch (err) {
      console.error("Voice enrollment failed", err);
      setDiagnosticError(err instanceof Error ? err.message : "声音档案录入失败。");
    } finally {
      setVoiceSaving(false);
    }
  };

  const removeVoiceProfile = async () => {
    const ok = await confirm({
      title: "删除声音档案",
      message: "要删除已保存的声音档案吗？",
      confirmLabel: "删除",
      tone: "danger",
    });
    if (!ok) return;
    setVoiceSaving(true);
    setDiagnosticError(null);
    try {
      await api.deleteVoiceProfile();
      setVoiceEnrolled(false);
    } catch (err) {
      console.error("Voice profile deletion failed", err);
      setDiagnosticError(err instanceof Error ? err.message : "无法删除声音档案。");
    } finally {
      setVoiceSaving(false);
    }
  };

  const startMicRecording = async (mode: RecordingMode) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setDiagnosticError("当前浏览器无法录制麦克风声音。");
      return;
    }

    const generation = recordingGenerationRef.current + 1;
    recordingGenerationRef.current = generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: mode === "voice" ? MIC_ONLY_AUDIO_CONSTRAINTS : true,
      });
      if (generation !== recordingGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream, getRecorderOptions());
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (generation !== recordingGenerationRef.current) return;
        const file = createRecordedFile(
          chunksRef.current,
          recorder.mimeType,
          mode === "voice" ? "voice-profile" : "mic-benchmark",
        );
        stopMediaTracks();
        clearRecordingTimer();
        setRecordingMode(null);
        setRecordingSeconds(0);
        if (mode === "voice") {
          void saveVoiceProfile(file);
        } else {
          setBenchmarkFile(file);
          void runBenchmark(file);
        }
      };

      recorder.start();
      setRecordingMode(mode);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => {
          const next = seconds + 1;
          const limit = mode === "voice" ? MAX_VOICE_RECORDING_SECONDS : MAX_RECORDING_SECONDS;
          if (next >= limit && recorder.state === "recording") {
            recorder.stop();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      if (generation !== recordingGenerationRef.current) return;
      console.error("Microphone recording failed", err);
      setDiagnosticError(err instanceof Error ? err.message : "无法开始录制麦克风声音。");
      stopMediaTracks();
      clearRecordingTimer();
      setRecordingMode(null);
    }
  };

  const stopMicRecording = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.stop();
    }
  };

  const selectDiarizer = async (mode: "lightweight" | "sortformer") => {
    setSavingSelection(true);
    setDiagnosticError(null);
    try {
      const updated = await api.updateDiarizationConfig({ selected_live_diarizer: mode });
      setDiarization(updated);
      setBenchmark(null);
    } catch (err) {
      console.error("Diarization selection failed", err);
      setDiagnosticError(err instanceof Error ? err.message : "无法更新说话人区分模式。");
    } finally {
      setSavingSelection(false);
    }
  };

  const saveThreshold = async () => {
    const next = Number(thresholdDraft.toFixed(2));
    setSavingThreshold(true);
    setDiagnosticError(null);
    try {
      const updated = await api.updateDiarizationConfig({ speaker_similarity_threshold: next });
      setDiarization(updated);
    } catch (err) {
      console.error("Speaker matching threshold update failed", err);
      setDiagnosticError(err instanceof Error ? err.message : "无法更新说话人匹配灵敏度。");
    } finally {
      setSavingThreshold(false);
    }
  };

  const selectedMode = diarization?.selected_live_diarizer ?? "lightweight";
  const effectiveMode = diarization?.effective_live_diarizer ?? selectedMode;
  const enhancedUnlocked = Boolean(diarization?.sortformer_selectable);
  const savedThreshold = diarization?.speaker_similarity_threshold ?? 0.72;
  const thresholdChanged = Math.abs(thresholdDraft - savedThreshold) >= 0.005;
  const recommendation = benchmark?.recommended_live_diarizer ?? (enhancedUnlocked ? "sortformer" : diarization?.recommended_live_diarizer) ?? "lightweight";
  const modeLabel = (mode: string) => mode === "sortformer" ? "增强模式" : "基础模式";
  const deviceLabel = diarization
    ? `${diarization.device.toUpperCase()}${diarization.gpu_name ? ` - ${diarization.gpu_name}` : ""}`
    : "未知";
  const gpuLabel = !diarization
    ? "未知"
    : diarization.gpu_backend === "rocm"
      ? "ROCm (AMD)"
      : diarization.gpu_backend === "cuda"
        ? "CUDA (NVIDIA)"
        : "无（CPU）";

  return (
    <div className="rounded-xl bg-surface p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-bold text-brand-dark-gray">区分说话人能力</h3>
          <p className="mt-1 font-body text-xs leading-relaxed text-brand-gray">
            检查这台电脑运行 NeMo Sortformer 的速度是否足够快，能否在会议中实时区分每位说话人。
          </p>
        </div>
        <button
          onClick={load}
          disabled={loadingDiagnostics}
          className="rounded border border-brand-light-gray-1 px-3 py-1.5 font-body text-xs text-brand-dark-gray transition-colors hover:border-brand-teal hover:text-brand-teal"
        >
          {loadingDiagnostics ? "检查中…" : "刷新"}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-brand-light-gray-1 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div>
            <p className="font-body text-[10px] uppercase text-brand-mid-gray">实时区分说话人</p>
            <p className="font-body text-xs text-brand-gray">
              新会议和导入的声音都会使用： <span className="font-semibold text-brand-dark-gray">{modeLabel(effectiveMode)}</span>
            </p>
          </div>
          <InfoPopover open={infoOpen} onOpenChange={setInfoOpen} />
        </div>

        <div className="inline-flex rounded-lg border border-brand-light-gray-1 bg-brand-light-gray-2/50 p-1">
          <DiarizerModeButton
            label="基础模式"
            active={selectedMode === "lightweight"}
            disabled={savingSelection}
            onClick={() => void selectDiarizer("lightweight")}
          />
          <DiarizerModeButton
            label="增强模式"
            active={selectedMode === "sortformer"}
            disabled={!enhancedUnlocked || savingSelection}
            title={enhancedUnlocked ? "使用 Sortformer" : "先通过基准测试，才能开启增强模式"}
            onClick={() => void selectDiarizer("sortformer")}
          />
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Metric label="推荐模式" value={modeLabel(recommendation)} />
        <Metric label="电脑设备" value={deviceLabel} title={deviceLabel} />
        <Metric label="显卡加速" value={gpuLabel} />
        <Metric
          label="实时速度"
          value={
            benchmark?.real_time_factor != null
              ? benchmark.real_time_factor.toFixed(2)
              : diarization?.benchmark_real_time_factor != null
                ? diarization.benchmark_real_time_factor.toFixed(2)
                : "尚未运行"
          }
        />
      </div>
      {diarization?.benchmark_measured_at && (
        <p className="mb-4 font-body text-[11px] text-brand-mid-gray">
          测试时间：{new Date(diarization.benchmark_measured_at).toLocaleString()}
          {diarization.benchmark_validity === "aged" ? ` - ${diarization.benchmark_validity_reason}` : ""}
        </p>
      )}
      {["incompatible", "superseded"].includes(diarization?.benchmark_validity ?? "") && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 font-body text-xs text-amber-800">
          {diarization?.benchmark_validity_reason}
        </p>
      )}

      <div className="mb-4 rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-body text-[10px] uppercase text-brand-mid-gray">说话人匹配</p>
            <p className="font-body text-xs text-brand-gray">
              匹配门槛： <span className="font-semibold text-brand-dark-gray">{thresholdDraft.toFixed(2)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveThreshold()}
            disabled={!thresholdChanged || savingThreshold || loadingDiagnostics}
            className="rounded bg-brand-teal px-3 py-1.5 font-body text-xs font-medium text-white transition-colors hover:bg-brand-teal-dark disabled:cursor-not-allowed disabled:bg-brand-light-gray-1"
          >
            {savingThreshold ? "保存中…" : "应用"}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-body text-[10px] text-brand-mid-gray">更容易合并</span>
          <input
            type="range"
            min={0.5}
            max={0.95}
            step={0.01}
            value={thresholdDraft}
            onChange={(e) => setThresholdDraft(Number(e.target.value))}
            className="min-w-0 flex-1 accent-brand-teal"
          />
          <span className="font-body text-[10px] text-brand-mid-gray">更容易区分</span>
          <input
            type="number"
            min={0.5}
            max={0.95}
            step={0.01}
            value={thresholdDraft.toFixed(2)}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (!Number.isNaN(value)) {
                setThresholdDraft(Math.min(0.95, Math.max(0.5, value)));
              }
            }}
            className="w-20 rounded border border-brand-light-gray-1 bg-surface px-2 py-1 font-body text-xs text-brand-dark-gray"
          />
        </div>
      </div>

      <div className="mb-4 rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-body text-[10px] uppercase text-brand-mid-gray">我的声音档案</p>
            <p className="mt-1 font-body text-xs text-brand-gray">
              {voiceEnrolled
                ? "你的加密声音特征已经准备好，可用于只通过麦克风区分说话人。"
                : "录制 4–10 秒声音。校准音频会被丢弃，只保留加密后的声音特征。"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={recordingMode === "voice"
                ? stopMicRecording
                : () => void startMicRecording("voice")}
              disabled={
                voiceSaving
                || benchmarking
                || (recordingMode !== null && recordingMode !== "voice")
              }
              className="rounded border border-brand-teal px-3 py-1.5 font-body text-xs font-medium text-brand-teal transition-colors hover:bg-brand-teal hover:text-white disabled:cursor-not-allowed disabled:border-brand-light-gray-1 disabled:text-brand-mid-gray"
            >
              {recordingMode === "voice"
                ? `停止（${recordingSeconds} 秒）`
                : voiceSaving
                  ? "保存中…"
                  : voiceEnrolled
                    ? "替换声音档案"
                    : "录入声音档案"}
            </button>
            {voiceEnrolled && (
              <button
                type="button"
                onClick={() => void removeVoiceProfile()}
                disabled={voiceSaving || recordingMode !== null}
                className="rounded border border-brand-light-gray-1 px-3 py-1.5 font-body text-xs text-brand-gray transition-colors hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                删除
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mb-4 rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 px-3 py-2">
        <p className="font-body text-xs text-brand-gray">
          {loadingDiagnostics
            ? "正在检查区分说话人的能力…"
            : benchmark?.reason ?? diarization?.selection_reason ?? diarization?.reason ?? "还没有加载检测结果。"}
        </p>
        {diarization?.gpu_memory_gb != null && (
          <p className="mt-1 font-body text-[10px] text-brand-mid-gray">显卡内存： {diarization.gpu_memory_gb} GB</p>
        )}
        <p className="mt-1 font-mono text-[10px] text-brand-mid-gray">{diarization?.model_id}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".m4a,.mp3,.wav,.ogg,.flac,.webm,audio/*"
          onChange={(e) => setBenchmarkFile(e.target.files?.[0] ?? null)}
          className="max-w-sm rounded border border-brand-light-gray-1 bg-surface px-3 py-1.5 font-body text-xs text-brand-dark-gray"
        />
        <button
          onClick={handleUploadedBenchmark}
          disabled={!benchmarkFile || benchmarking || recordingMode !== null}
          className="rounded bg-brand-teal px-3 py-1.5 font-body text-xs font-medium text-white transition-colors hover:bg-brand-teal-dark disabled:cursor-not-allowed disabled:bg-brand-light-gray-1"
        >
          {benchmarking ? "基准测试中…" : "运行基准测试"}
        </button>
        <button
          onClick={recordingMode === "benchmark"
            ? stopMicRecording
            : () => void startMicRecording("benchmark")}
          disabled={
            voiceSaving
            || (benchmarking && recordingMode !== "benchmark")
            || (recordingMode !== null && recordingMode !== "benchmark")
          }
          className="rounded border border-brand-teal px-3 py-1.5 font-body text-xs font-medium text-brand-teal transition-colors hover:bg-brand-teal hover:text-white disabled:cursor-not-allowed disabled:border-brand-light-gray-1 disabled:text-brand-mid-gray"
        >
          {recordingMode === "benchmark"
            ? `停止录制（${recordingSeconds} 秒）`
            : "录制麦克风测试"}
        </button>
        {benchmark ? (
          <span className="font-body text-xs text-brand-mid-gray">
            测试了 {benchmark.audio_seconds.toFixed(1)} 秒声音，处理耗时 {benchmark.processing_seconds.toFixed(1)} 秒
          </span>
        ) : benchmarkFile && (
          <span className="font-body text-[10px] text-brand-mid-gray">
            至少需要 {MIN_BENCHMARK_SECONDS} 秒声音；只会测试前 {MAX_RECORDING_SECONDS} 秒。
          </span>
        )}
      </div>

      {diagnosticError && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 font-body text-xs text-red-700">
          {diagnosticError} {loadingDiagnostics ? "正在重试…" : ""}
        </p>
      )}
    </div>
  );
}

function DiarizerModeButton({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md px-3 py-1.5 font-body text-xs font-semibold transition-all active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? "bg-surface text-brand-teal shadow-sm"
          : "text-brand-mid-gray hover:bg-surface/70 hover:text-brand-dark-gray"
      }`}
    >
      {label}
    </button>
  );
}

function InfoPopover({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <div
      className="relative"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={() => onOpenChange(false)}
    >
      <button
        type="button"
        aria-label="比较两种说话人区分模式"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="grid h-6 w-6 place-items-center rounded-full border border-brand-light-gray-1 bg-surface font-display text-[11px] font-bold text-brand-teal shadow-sm transition-colors hover:border-brand-teal"
      >
        i
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-20 w-[min(22rem,calc(100vw-3rem))] rounded-lg border border-brand-light-gray-1 bg-surface p-4 shadow-xl shadow-brand-dark-gray/10">
          <div className="space-y-3 font-body text-xs leading-relaxed text-brand-gray">
            <p>
              <span className="font-semibold text-brand-dark-gray">基础模式</span> 使用本地声音检测和说话人特征识别，处理速度快，使用 CPU；当电脑性能或模型不确定时，选择它更稳妥。
            </p>
            <p>
              <span className="font-semibold text-brand-dark-gray">增强模式</span> 会在电脑通过测试后使用 NeMo Sortformer。多人会议中它能更准确地区分轮流发言，但更占资源，而且会分批处理声音。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, title, capitalize = false }: { label: string; value: string; title?: string; capitalize?: boolean }) {
  return (
    <div className="rounded border border-brand-light-gray-1 bg-brand-light-gray-2/30 p-3">
      <p className="font-body text-[10px] uppercase text-brand-mid-gray">{label}</p>
      <p
        className={`mt-1 truncate font-display text-sm font-bold text-brand-dark-gray ${capitalize ? "capitalize" : ""}`}
        title={title ?? value}
      >
        {value}
      </p>
    </div>
  );
}

function getRecorderOptions(): MediaRecorderOptions {
  const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { mimeType } : {};
}

function createRecordedFile(chunks: BlobPart[], mimeType: string, baseName: string): File {
  const type = mimeType || "audio/webm";
  const extension = type.includes("mp4") ? "m4a" : "webm";
  return new File([new Blob(chunks, { type })], `${baseName}.${extension}`, { type });
}
