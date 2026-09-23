import { useEffect, useState, type ReactNode } from "react";
import type { Directive, Document, Session, Speaker } from "../../types";
import * as api from "../../services/api";
import DocumentUpload from "./DocumentUpload";
import DirectiveInput from "./DirectiveInput";
import DirectiveList from "./DirectiveList";
import AgentSelector from "./AgentSelector";
import MeetingContextSetup, { MEETING_TYPES } from "./MeetingContextSetup";
import SpeakerSetup from "./SpeakerSetup";
import TranscriptImport from "./TranscriptImport";
import EditableSessionName from "../EditableSessionName";
import InfoTooltip from "../InfoTooltip";

interface Props {
  session: Session;
  directives: Directive[];
  documents: Document[];
  speakers: Speaker[];
  transcriptCount: number;
  processingTranscript?: boolean;
  processingError?: string | null;
  startError?: string | null;
  isStarting?: boolean;
  onStartCall: () => void;
  onOpenVoiceSettings: () => void;
  captureSystemAudio?: boolean;
  onToggleSystemAudio?: (enabled: boolean) => void;
  onProcessTranscript: () => void;
  onRefreshDirectives: () => void;
  onRefreshDocuments: () => void;
  onRefreshSpeakers: () => void;
  onRefreshTranscripts: () => Promise<void>;
  onRenameSession: (name: string) => Promise<void>;
  onUpdateSessionContext: (data: { meeting_type?: Session["meeting_type"]; meeting_context?: string }) => Promise<void>;
}

// One setup step. Collapsed by default when it holds nothing yet, open when
// it does, and the header always says how much is in it, so the page reads
// as a checklist rather than a form.
function SetupSection({
  title,
  summary,
  tooltip,
  defaultOpen,
  optional = false,
  children,
}: {
  title: string;
  summary: string;
  tooltip?: { content: string; details: string[] };
  defaultOpen: boolean;
  optional?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `precall-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section className="rounded-xl border border-brand-light-gray-1 bg-surface shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-brand-mid-gray transition-transform ${open ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="min-w-0">
            <span className="font-display text-sm font-semibold text-brand-dark-gray">
              {title}
              {optional && <span className="ml-1.5 font-body text-[11px] font-normal text-brand-mid-gray">可选</span>}
            </span>
            <span className="block truncate font-body text-xs text-brand-mid-gray">{summary}</span>
          </span>
        </button>
        {tooltip && <InfoTooltip content={tooltip.content} details={tooltip.details} />}
      </div>
      <div id={id} hidden={!open} className="border-t border-brand-light-gray-1 px-4 py-4">
        {children}
      </div>
    </section>
  );
}

function pluralize(count: number, noun: string): string {
  return `${count}${noun}`;
}

export default function PreCallView({
  session,
  directives,
  documents,
  speakers,
  transcriptCount,
  processingTranscript = false,
  processingError = null,
  startError = null,
  isStarting = false,
  onStartCall,
  onOpenVoiceSettings,
  captureSystemAudio,
  onToggleSystemAudio,
  onProcessTranscript,
  onRefreshDirectives,
  onRefreshDocuments,
  onRefreshSpeakers,
  onRefreshTranscripts,
  onRenameSession,
  onUpdateSessionContext,
}: Props) {
  const [hasImport, setHasImport] = useState(false);
  const [voiceEnrolled, setVoiceEnrolled] = useState<boolean | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const hasImportedTranscript = hasImport || transcriptCount > 0;

  useEffect(() => {
    let active = true;
    api.getVoiceProfileStatus()
      .then((status) => {
        if (active) setVoiceEnrolled(status.enrolled);
      })
      .catch((err) => console.error("Failed to load voice profile status", err));
    return () => { active = false; };
  }, []);

  const handleImported = () => {
    setHasImport(true);
    void onRefreshTranscripts();
  };

  const typeLabel = MEETING_TYPES.find((t) => t.value === session.meeting_type)?.label ?? "普通会议";
  const activeDirectives = directives.filter((d) => d.active).length;
  const readiness = [
    typeLabel,
    documents.length ? pluralize(documents.length, "份资料") : null,
    activeDirectives ? pluralize(activeDirectives, "条提示") : null,
    speakers.length ? pluralize(speakers.length, "位参与者") : "参与者会自动识别",
  ].filter(Boolean).join(" · ");

  const soleUserNeedsVoice = speakers.filter((s) => s.is_user).length === 1 && voiceEnrolled === false;
  const error = hasImportedTranscript ? processingError : startError;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12">
      {/* Action bar: the one thing this screen is for stays in reach while
          the setup below scrolls. */}
      <div className="sticky top-0 z-10 -mx-4 border-b border-brand-light-gray-1 bg-canvas/95 px-4 pb-3 pt-5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <EditableSessionName
              name={session.name}
              onRename={onRenameSession}
              className="text-brand-teal-dark"
            />
            <p className="mt-0.5 truncate font-body text-xs text-brand-mid-gray">{readiness}</p>
          </div>
          {hasImportedTranscript ? (
            <button
              type="button"
              onClick={onProcessTranscript}
              disabled={processingTranscript}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-amber px-5 py-2.5 font-display text-sm font-semibold text-white shadow-md transition-colors hover:bg-amber-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-amber focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {processingTranscript ? "处理中…" : "分析文字稿"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartCall}
              disabled={isStarting}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 font-display text-sm font-semibold text-white shadow-md transition-colors hover:bg-brand-teal-dark hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-teal-light focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${isStarting ? "animate-pulse bg-white/70" : "bg-white"}`} aria-hidden="true" />
              {isStarting ? "正在开始…" : "开始会议"}
            </button>
          )}
        </div>
        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-body text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {/* Live-call options and the recording notice sit right under the
            button they qualify; an import has neither. */}
        {!hasImportedTranscript && (
          <div className="rounded-xl border border-brand-light-gray-1 bg-surface p-4 shadow-sm">
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="font-display text-sm font-semibold text-brand-dark-gray">同时记录会议声音</span>
                <span className="mt-0.5 block font-body text-xs leading-relaxed text-brand-mid-gray">
                  麦克风声音会一直记录。开始会议时，你还可以选择会议标签页、窗口或屏幕的声音，
                  这样助手就能把远程嘉宾和你的声音区分开。
                </span>
              </span>
              <span className="relative mt-0.5 inline-flex shrink-0">
                <input
                  type="checkbox"
                  role="switch"
                  checked={captureSystemAudio ?? false}
                  onChange={(e) => onToggleSystemAudio?.(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="h-6 w-11 rounded-full bg-brand-light-gray-1 transition-colors peer-checked:bg-brand-teal peer-focus-visible:ring-2 peer-focus-visible:ring-brand-teal-light" aria-hidden="true" />
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-5" aria-hidden="true" />
              </span>
            </label>
            {captureSystemAudio === false && (
              <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 font-body text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                只记录麦克风：只有麦克风能听到远程嘉宾时，才能记录他们说的话；如果你戴着耳机，
                远程声音可能会漏掉。
                {soleUserNeedsVoice && (
                  <>
                    {" "}语音校准也能让系统更可靠地识别你。{" "}
                    <button type="button" onClick={onOpenVoiceSettings} className="font-semibold underline">
                      打开“语音转文字和声音”设置
                    </button>
                  </>
                )}
              </p>
            )}
            <p className="mt-3 flex flex-wrap items-center gap-x-2 font-body text-xs text-brand-gray">
              <span className="text-brand-amber" aria-hidden="true">&#9888;</span>
              <span>本次会议会被录音并转成文字，请先告知所有参与者，并确认没有人反对。</span>
              <button
                type="button"
                onClick={() => setShowConsent((v) => !v)}
                aria-expanded={showConsent}
                className="font-semibold text-brand-teal hover:underline"
              >
                {showConsent ? "收起" : "查看说明"}
              </button>
            </p>
            {showConsent && (
              <p className="mt-2 font-body text-xs leading-relaxed text-brand-mid-gray">
                随听 会把会议声音实时转成文字，并据此整理问题和要点。开始前，请确保所有
                参与者都知道会议会被录音和转写，并已同意或没有提出反对。请按照当地法律和公司规定操作。
              </p>
            )}
          </div>
        )}

        <SetupSection
          title="会议背景"
          summary={session.meeting_context ? session.meeting_context : "告诉助手这是什么会议，以及你希望关注什么"}
          defaultOpen
          tooltip={{
            content: "告诉助手这是什么会议，避免它把所有会议都当成客户销售会议来分析。",
            details: [
              "内部培训：重点关注概念、容易误解的地方、学员问题和后续资料",
              "供应商或合作伙伴：重点关注路线、计划更新、承诺和合作动作",
              "客户或交付：重点关注目标、风险、决定、机会和下一步行动",
            ],
          }}
        >
          <MeetingContextSetup session={session} onUpdate={onUpdateSessionContext} />
        </SetupSection>

        <SetupSection
          title="资料"
          optional
          summary={documents.length ? documents.map((d) => d.filename).join(", ") : "助手可以参考的文件"}
          defaultOpen={documents.length > 0}
          tooltip={{
            content: "在会议前上传资料，助手会参考这些文件来生成问题和要点。",
            details: [
              "上传的文件会和实时文字记录一起交给 Gemini 分析",
              "开启“隐私优先”或“个人信息保护”后，文字文件会只在这台电脑上读取",
              "支持 PDF、Word、表格和普通文字文件",
              "文件会和本次会议一起保存，也可以随时删除",
            ],
          }}
        >
          <DocumentUpload sessionId={session.id} documents={documents} onRefresh={onRefreshDocuments} />
        </SetupSection>

        <SetupSection
          title="导入文字稿或录音"
          optional
          summary={
            hasImportedTranscript
              ? transcriptCount
                ? `${transcriptCount} 行文字，等待分析`
                : "文字稿已导入，等待分析"
              : "不开始实时会议，直接分析以前的文字稿或录音"
          }
          defaultOpen={hasImportedTranscript}
          tooltip={{
            content: "你可以导入以前的文字稿或录音来分析，助手会像分析刚结束的会议一样处理它。",
            details: [
              "文字稿文件：.txt、.md、.docx，会按说话人拆分",
              "录音文件：.m4a、.mp3、.wav、.ogg、.flac，会先转成文字",
              "导入后，右上角按钮会变成“分析文字稿”",
            ],
          }}
        >
          <TranscriptImport sessionId={session.id} onImported={handleImported} />
        </SetupSection>

        <SetupSection
          title="关注提示"
          optional
          summary={activeDirectives ? `${pluralize(activeDirectives, "条已启用提示")}` : "告诉助手这场会议要特别留意什么"}
          defaultOpen={directives.length > 0}
          tooltip={{
            content: "告诉助手这场会议要特别关注什么。这些提示会影响所有助手提出的问题和整理的要点。",
            details: [
              "例如：“记录销售团队不熟悉的概念，以及给工程师的追问”",
              "提示可以随时开关，不必删除",
              "已启用的提示会加入每一轮分析",
              "会议进行中也可以在实时页面添加提示",
            ],
          }}
        >
          <div className="space-y-4">
            <DirectiveInput sessionId={session.id} onAdded={onRefreshDirectives} />
            <DirectiveList sessionId={session.id} directives={directives} onRefresh={onRefreshDirectives} />
          </div>
        </SetupSection>

        <SetupSection
          title="参与者"
          optional
          summary={speakers.length ? speakers.map((s) => s.name).join(", ") : "会议中会自动识别；也可以提前填写名字来标记声音"}
          defaultOpen={speakers.length > 0}
          tooltip={{
            content: "提前填写参与者，助手就能根据声音把文字记录对应到具体的人。如果跳过，助手会自动识别并使用临时名称。",
            details: [
              "为每位参与者填写名字、角色和颜色",
              "把其中一位标记为“我”，帮助助手认出你的声音",
              "提前填写参与者能提高分辨说话人的准确度",
              "会议中或会后仍然可以给自动识别的人改名",
            ],
          }}
        >
          <SpeakerSetup sessionId={session.id} speakers={speakers} onRefresh={onRefreshSpeakers} />
        </SetupSection>

        <SetupSection
          title="本场会议使用的助手"
          optional
          summary="默认使用管理设置里的助手，也可以只为本场会议调整"
          defaultOpen={false}
          tooltip={{
            content: "选择本场会议要启用哪些 AI 助手。每个助手会从不同角度独立分析会议文字。",
            details: [
              "综合分析助手：定期整理问题、观察、机会和行动项",
              "主要助手：检查质量、汇总其他助手的结果并发现重要模式",
              "机会助手：把客户机会和产品服务目录对应起来",
              "声音桥接助手：帮助实时显示转写文字",
              "这里的设置只对本场会议生效，会覆盖管理设置里的默认值",
            ],
          }}
        >
          <AgentSelector sessionId={session.id} />
        </SetupSection>
      </div>
    </div>
  );
}
