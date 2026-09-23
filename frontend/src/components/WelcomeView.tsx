import { useEffect, useState } from "react";
import * as api from "../services/api";
import { setupReadiness, toReadinessAgentModels, type SetupReadiness } from "../lib/providerOnboarding";

interface WelcomeViewProps {
  hasSessions: boolean;
  onNewSession: () => void;
  onOpenApiKeys: () => void;
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function StepCard({
  step,
  done,
  title,
  description,
  notice,
  action,
}: {
  step: number;
  done: boolean;
  title: string;
  description: string;
  // Plain-language explanation of why the step is still incomplete even
  // though the user already did something (e.g. saved a mismatched key).
  notice?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl bg-surface p-5 text-left shadow-sm ring-1 ring-brand-light-gray-1/60">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${
          done ? "bg-brand-teal text-white" : "bg-brand-light-gray-2 text-brand-gray"
        }`}
        aria-label={done ? `第 ${step} 步已完成` : `第 ${step} 步`}
      >
        {done ? <CheckIcon /> : step}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-sm font-bold text-brand-dark-gray">{title}</h3>
        <p className="mt-1 font-body text-xs leading-relaxed text-brand-gray">{description}</p>
        {notice && !done && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-body text-[11px] leading-relaxed text-amber-900">
            {notice}
          </p>
        )}
      </div>
      {action && !done && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 self-center rounded-lg bg-brand-teal px-3.5 py-2 font-body text-xs font-semibold text-white transition-colors hover:bg-brand-teal/90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// Shown in the content area when no session is selected. For a brand-new
// workspace (no sessions yet) it becomes a first-run checklist driven by real
// setup state and the first session. Once sessions exist it stays a quiet
// empty state.
export default function WelcomeView({ hasSessions, onNewSession, onOpenApiKeys }: WelcomeViewProps) {
  const [readiness, setReadiness] = useState<SetupReadiness | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSessions) {
      // Step 1 completes only when the currently selected transcription and
      // agent configuration can actually run.
      Promise.all([
        api.getPrivacyConfig().catch(() => null),
        api.getTranscriptionReadiness().catch(() => null),
        api.listAgents().catch(() => []),
        api.listModels().catch(() => []),
      ]).then(([p, transcription, agents, models]) => {
        setReadiness(
          setupReadiness({
            localOnly: p?.local_only === true,
            transcription,
            agentModels: toReadinessAgentModels(agents, models),
          })
        );
      });
    }
    api.getAppMeta().then((m) => setVersion(m.version)).catch(() => null);
  }, [hasSessions]);

  const versionFooter = version && (
    <p className="mt-8 text-center font-body text-[11px] text-brand-mid-gray">随听 版本 {version}</p>
  );

  if (hasSessions) {
    return (
      <div className="flex h-full items-center justify-center text-brand-mid-gray">
        <div className="text-center">
          <h2 className="mb-2 font-display text-2xl font-semibold">欢迎使用 随听</h2>
          <p className="font-body">从左侧选择一场会议，或新建一场会议开始使用。</p>
          {versionFooter}
        </div>
      </div>
    );
  }

  const setupReady = readiness?.ready === true;
  const checklistLoaded = readiness !== null;
  const setupNotice =
    checklistLoaded && !setupReady
      ? "AI 设置还没准备好。请打开 AI 设置，按页面提示选择可用的语音转文字模型和助手。"
      : undefined;

  return (
    <div className="flex h-full items-start justify-center overflow-auto bg-brand-light-gray-2 p-6">
      <div className="w-full max-w-2xl py-8">
        <div className="mb-8 text-center">
          <h2 className="font-display text-3xl font-bold text-brand-dark-gray">欢迎使用 随听</h2>
          <p className="mx-auto mt-3 max-w-xl font-body text-sm leading-relaxed text-brand-gray">
            随听 会在会议进行时帮你实时记录内容、分辨是谁在说话，及时找出问题和机会，
            会后还会整理成一份可以查看、导出的会议总结。
          </p>
        </div>

        <div className="space-y-3">
          <StepCard
            step={1}
            done={checklistLoaded && setupReady}
            title="选择 AI 模型"
            description="可以直接使用电脑本地的语音转文字，不需要填写密钥。也可以连接 Google、OpenAI 等服务，再为每个助手选择模型；带有“推荐”的选项适合先试用。"
            notice={setupNotice}
            action={{ label: "打开 AI 设置", onClick: onOpenApiKeys }}
          />
          <StepCard
            step={2}
            done={hasSessions}
            title="新建第一场会议"
            description="每场会议会单独保存参与者、资料、提示、文字记录，以及助手发现的问题和机会。"
            action={{ label: "新建会议", onClick: onNewSession }}
          />
          <StepCard
            step={3}
            done={false}
            title="开始会议，或导入已有录音"
            description="进入会议设置后，可以打开麦克风并选择会议声音进行实时记录，也可以导入已有录音或文字稿，让助手会后分析。"
          />
        </div>

        <p className="mt-6 text-center font-body text-xs text-brand-mid-gray">
          之后可以在“管理设置”里调整助手、模型、提示词和隐私选项。
        </p>
        {versionFooter}
      </div>
    </div>
  );
}
