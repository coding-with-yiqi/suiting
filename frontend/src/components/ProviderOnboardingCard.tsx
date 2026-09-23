import { useCallback, useEffect, useState } from "react";
import type { PrivacyConfig } from "../types";
import * as api from "../services/api";
import {
  onboardingStage,
  setupReadiness,
  toReadinessAgentModels,
  type ReadinessTranscription,
  type SetupReadiness,
} from "../lib/providerOnboarding";

interface ProviderOnboardingCardProps {
  privacy: PrivacyConfig | null;
  onPrivacyChanged: (config: PrivacyConfig) => void;
  // Bumped by the parent whenever a credential changes so readiness re-checks.
  refreshToken: number;
  onContinue: () => void;
}

// Contextual first-run setup state shown above Connections when the screen was
// entered from the welcome checklist. Credentials make models available;
// explicit selections determine whether the configuration is usable.
export default function ProviderOnboardingCard({
  privacy,
  onPrivacyChanged,
  refreshToken,
  onContinue,
}: ProviderOnboardingCardProps) {
  const [anyKeySaved, setAnyKeySaved] = useState(false);
  const [readiness, setReadiness] = useState<SetupReadiness | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);

  const localOnly = privacy?.local_only === true;

  const check = useCallback(async () => {
    try {
      const [credentials, transcription, agents, models] = await Promise.all([
        api.listCredentials(),
        api.getTranscriptionReadiness().catch(() => null),
        api.listAgents(),
        api.listModels(),
      ]);
      setAnyKeySaved(credentials.some((c) => c.configured || c.env_fallback));
      setReadiness(
        setupReadiness({
          localOnly,
          transcription: transcription as ReadinessTranscription | null,
          agentModels: toReadinessAgentModels(agents, models),
        })
      );
    } catch (err) {
      console.error("Failed to check setup readiness", err);
    }
  }, [localOnly]);

  useEffect(() => {
    check();
  }, [check, refreshToken]);

  const handlePrivacyFirst = async () => {
    setPrivacyBusy(true);
    try {
      onPrivacyChanged(await api.updatePrivacyConfig(true));
    } catch (err) {
      console.error("Failed to enable Privacy First", err);
    } finally {
      setPrivacyBusy(false);
    }
  };

  const stage = readiness ? onboardingStage({ anyKeySaved, readiness }) : "choose";
  const disabledImpact = privacy?.impact.disabled ?? [];

  return (
    <div className="rounded-xl border border-brand-teal/30 bg-surface p-5 shadow-sm">
      <p className="font-body text-[10px] font-semibold uppercase tracking-wider text-brand-teal">
        首次设置
      </p>
      <h3 className="mt-0.5 font-display text-base font-bold text-brand-dark-gray">
        先连接服务，再选择模型
      </h3>
      <p className="mt-1 font-body text-xs leading-relaxed text-brand-gray">
        内置的本地转文字不需要密钥。只添加你想用的服务，然后到“分析助手”和“转文字与声音”中选择模型。
        “推荐”标记可以帮你快速开始。
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-brand-teal/40 bg-brand-teal/5 p-3.5">
          <h4 className="font-display text-sm font-bold text-brand-dark-gray">
            云端 AI
          </h4>
          <p className="mt-1.5 font-body text-xs leading-relaxed text-brand-gray">
            添加 Google 或 OpenAI 密钥后，就能使用对应服务商的转文字、实时字幕和分析助手模型。保存时会测试连接，但不会改变你已经选择的模型。
          </p>
        </div>

        <div className="rounded-lg border border-brand-light-gray-1 p-3.5">
          <h4 className="font-display text-sm font-bold text-brand-dark-gray">
            本地 AI 与隐私优先
          </h4>
          <p className="mt-1.5 font-body text-xs leading-relaxed text-brand-gray">
            本地转文字不需要密钥。如果想在本地分析，请在下面连接自己电脑上的模型服务，运行“本机性能测试”，再到“分析助手”中选择通过测试的推荐模型。隐私优先会阻止云端连接。
            {disabledImpact.length > 0 && (
              <>
                {" "}需要注意： {disabledImpact.map((i) => i.feature).join(", ")}{" "}
                在添加云端密钥前会保持关闭。
              </>
            )}
          </p>
          {localOnly ? (
            <p className="mt-2 font-body text-xs font-medium text-brand-teal">
              隐私优先已开启。
            </p>
          ) : (
            <button
              type="button"
              onClick={handlePrivacyFirst}
              disabled={privacyBusy}
              className="mt-2 rounded border border-brand-light-gray-1 px-3 py-1.5 font-body text-xs font-medium text-brand-dark-gray transition-colors hover:border-brand-teal hover:text-brand-teal disabled:opacity-40"
            >
              开启隐私优先
            </button>
          )}
        </div>
      </div>

      {stage === "partial" && readiness && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <p className="font-body text-xs font-semibold text-amber-900">
            快完成了——密钥已经保存，但当前设置还不能运行。
          </p>
          <p className="mt-1 font-body text-xs leading-relaxed text-amber-900">
            {readiness.reason}
          </p>
        </div>
      )}

      {stage === "ready" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-teal/40 bg-brand-teal/5 px-3.5 py-2.5">
          <p className="font-body text-xs font-medium text-brand-dark-gray">
            {localOnly
              ? "设置完成——你选择的本地转文字和分析助手模型已经可以使用。"
              : "设置完成——你选择的转文字和分析助手模型已经可以使用。"}
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-lg bg-brand-teal px-3.5 py-2 font-body text-xs font-semibold text-white transition-colors hover:bg-brand-teal/90"
          >
            开始第一次会议
          </button>
        </div>
      )}
    </div>
  );
}
