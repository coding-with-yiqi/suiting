const AGENT_LABELS: Record<string, string> = {
  audio_gateway: "音频桥接助手",
  consolidated_analyst: "综合分析助手",
  objection_handler: "异议识别助手",
  synthesizer: "洞察整理助手",
  opportunity_specialist: "机会识别助手",
  strategic_signals: "战略信号助手",
  transcript_refiner: "转录校对助手",
  brief_meeting_lens: "会议总结视角",
  brief_discovery_lens: "发现问题视角",
  brief_arbiter: "总结校对助手",
};

export function agentDisplayName(slug: string, fallback: string): string {
  return AGENT_LABELS[slug] || fallback;
}
