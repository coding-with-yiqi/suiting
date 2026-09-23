import { useEffect, useState } from "react";
import type { MeetingType, Session } from "../../types";

interface Props {
  session: Session;
  onUpdate: (data: { meeting_type?: MeetingType; meeting_context?: string }) => Promise<void>;
}

export const MEETING_TYPES: { value: MeetingType; label: string; hint: string; placeholder: string }[] = [
  {
    value: "general",
    label: "普通会议 / 自动判断",
    hint: "让助手根据会议内容和你填写的背景，自动判断这是什么类型的会议。",
    placeholder: "例如：讨论加密算法的行业变化，以及销售团队需要补充哪些培训。",
  },
  {
    value: "client_sales",
    label: "客户 / 潜在客户",
    hint: "适合了解客户需求、推进合作、识别购买信号和安排销售跟进。",
    placeholder: "例如：和客户的技术负责人讨论 AI 准备情况、风险、时间计划，以及我们可以提供哪些帮助。",
  },
  {
    value: "customer_delivery",
    label: "客户交付",
    hint: "适合讨论项目实施、日常运营或技术协作。",
    placeholder: "例如：每周一次的迁移计划会议，重点记录阻碍、负责人、范围决定和下一步行动。",
  },
  {
    value: "internal_enablement",
    label: "内部培训",
    hint: "适合培训、知识分享和技术教学。",
    placeholder: "例如：售前工程师给销售团队讲解加密算法，以及怎样向客户讲清楚。",
  },
  {
    value: "internal_checkin",
    label: "内部沟通",
    hint: "适合一对一沟通、辅导，或非正式的内部交流。",
    placeholder: "例如：快速了解同事正在做什么，以及他可能需要哪些支持。",
  },
  {
    value: "vendor_partner",
    label: "供应商 / 合作伙伴",
    hint: "适合讨论产品路线、合作计划、联盟或供应商更新。",
    placeholder: "例如：供应商介绍计划更新，包括路线变化、一线需求、培训缺口和后续承诺。",
  },
];

export default function MeetingContextSetup({ session, onUpdate }: Props) {
  const [meetingType, setMeetingType] = useState<MeetingType>(session.meeting_type || "general");
  const [meetingContext, setMeetingContext] = useState(session.meeting_context || session.notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMeetingType(session.meeting_type || "general");
    setMeetingContext(session.meeting_context || session.notes || "");
  }, [session.id, session.meeting_type, session.meeting_context, session.notes]);

  const selected = MEETING_TYPES.find((type) => type.value === meetingType) || MEETING_TYPES[0];
  const dirty = meetingType !== session.meeting_type || meetingContext !== (session.meeting_context || "");

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({
        meeting_type: meetingType,
        meeting_context: meetingContext.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-brand-light-gray-1 bg-surface p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-[220px,1fr]">
        <div>
          <label className="mb-1 block font-body text-xs font-semibold uppercase tracking-wide text-brand-mid-gray">
            会议类型
          </label>
          <select
            value={meetingType}
            onChange={(event) => setMeetingType(event.target.value as MeetingType)}
            className="w-full rounded-md border border-brand-light-gray-1 bg-surface px-3 py-2 font-body text-sm text-brand-dark-gray focus:border-brand-teal-light focus:ring-1 focus:ring-brand-teal-light"
          >
            {MEETING_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <p className="mt-2 font-body text-xs leading-relaxed text-brand-mid-gray">{selected.hint}</p>
        </div>

        <div>
          <label className="mb-1 block font-body text-xs font-semibold uppercase tracking-wide text-brand-mid-gray">
            会议目的 / 背景
          </label>
          <textarea
            value={meetingContext}
            onChange={(event) => setMeetingContext(event.target.value)}
            rows={4}
            placeholder={selected.placeholder}
            className="w-full resize-none rounded-md border border-brand-light-gray-1 bg-surface px-3 py-2 font-body text-sm text-brand-dark-gray placeholder:text-brand-mid-gray focus:border-brand-teal-light focus:ring-1 focus:ring-brand-teal-light"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-body text-xs text-brand-mid-gray">这段背景会和本次会议一起保存。</p>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="rounded-md bg-brand-teal px-3 py-1.5 font-body text-xs font-semibold text-white transition-colors hover:bg-brand-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存背景"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
