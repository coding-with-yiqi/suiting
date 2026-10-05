import type { Question, QuestionEventData } from "../types";

/**
 * Turn a websocket candidate into the same shape used by REST questions.
 * Keep defaults in one place for all candidates in a stream.
 */
export function questionFromEvent(data: QuestionEventData, sessionId: string): Question {
  return {
    id: data.id,
    session_id: sessionId,
    item_type: data.item_type || "question",
    lens_label: data.lens_label || "",
    question: data.question,
    rationale: data.rationale,
    source_context: data.source_context,
    speaker_id: data.speaker_id ?? null,
    directive_id: data.directive_id,
    starred: false,
    dismissed: false,
    delivery_state: data.delivery_state ?? "pending",
    created_at: data.timestamp || new Date().toISOString(),
    answered: false,
    answer_summary: "",
    needs_followup: false,
    followup_question: "",
    is_followup: data.is_followup || false,
    agent_source: data.agent_source,
    offering_match: data.offering_match || "",
    vote: data.vote ?? 0,
    enhanced: data.enhanced ?? false,
  };
}

/**
 * Add all candidates from one websocket cycle, newest first, without losing
 * rows when React batches state updates. A repeated creation event is a
 * replay; keep the current row, including edits, review and answer state.
 */
export function appendLiveQuestions(
  previous: Question[],
  incoming: QuestionEventData[],
  sessionId: string,
): Question[] {
  const next = [...previous];
  for (const data of incoming) {
    if (!data?.id || !data.question?.trim()) continue;
    const candidate = questionFromEvent(data, sessionId);
    const index = next.findIndex((question) => question.id === candidate.id);
    if (index === -1) {
      next.unshift(candidate);
      continue;
    }
  }
  return next;
}
