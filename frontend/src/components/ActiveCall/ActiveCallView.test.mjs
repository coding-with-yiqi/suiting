/**
 * The End Call window must never look like a fault (ALP-171).
 *
 * Ending the call closes the socket before the post-call refreshes finish, and
 * the active view stays mounted through that gap. Acceptance four measured
 * sixteen seconds of "Connection to the backend was lost" and a Resume Audio
 * button after the user had deliberately ended the call.
 *
 * Also holds the call screen's density contract (ALP-305): the top bar carries
 * meters and controls but not setup information the operator typed themselves,
 * diagnostics stay out of the way, and the transcript column can be put away.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const componentPath = fileURLToPath(new URL("./ActiveCallView.tsx", import.meta.url));
const outputDir = await mkdtemp(join(tmpdir(), "active-call-test-"));
const outputPath = join(outputDir, "bundle.cjs");

await build({
  stdin: {
    contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import ActiveCallView from "./ActiveCallView.tsx";
      export function render(props) {
        return renderToStaticMarkup(React.createElement(ActiveCallView, props));
      }
    `,
    resolveDir: dirname(componentPath),
    sourcefile: "active-call-test-entry.tsx",
    loader: "tsx",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: outputPath,
});

const { render } = createRequire(import.meta.url)(outputPath);

after(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

const PAUSED_BANNER = "录音已暂停";
const RESUME = "继续录音";

const noop = () => {};

function props(overrides = {}) {
  return {
    session: {
      id: "s1",
      name: "Acceptance",
      state: "active",
      created_at: new Date(0).toISOString(),
      started_at: new Date(0).toISOString(),
      ended_at: null,
      notes: null,
      meeting_type: "general",
      meeting_context: "",
      group_id: null,
      speaker_context_dirty: false,
      speaker_context_enhanced_at: null,
    },
    questions: [],
    transcripts: [],
    directives: [],
    speakers: [],
    interimText: "",
    // The socket is already gone: this is the state the window is measured in.
    status: "disconnected",
    isCapturing: false,
    isStarting: false,
    audioLevel: 0,
    audioStats: { chunksSent: 0, bytesSent: 0, chunksDropped: 0, lastSentAt: null },
    synthesis: null,
    activity: null,
    postProcessing: null,
    onEndCall: noop,
    onResumeAudio: noop,
    onAddDirective: noop,
    onAsk: noop,
    askModels: [],
    askModelId: "",
    onAskModelChange: noop,
    localOnly: false,
    pendingAsk: null,
    askError: null,
    onStarQuestion: noop,
    onDismissQuestion: noop,
    onVoteQuestion: noop,
    ...overrides,
  };
}

test("ending the call never shows the lost-connection banner or Resume", () => {
  // Exactly the acceptance-four window: stop resolved completed, socket closed,
  // capture stopped, and the post-call refreshes still in flight.
  const html = render(props({ ending: true }));

  assert.doesNotMatch(html, new RegExp(PAUSED_BANNER));
  assert.doesNotMatch(html, new RegExp(RESUME));
  assert.doesNotMatch(html, /未在录音/);
  // It says what is actually happening instead.
  assert.match(html, /正在收尾/);
});

test("a genuine mid-call socket loss explains the recording risk and recovery", () => {
  // ALP-165 depends on this banner; the fix must not weaken it.
  const html = render(props({ ending: false }));

  assert.match(html, new RegExp(PAUSED_BANNER));
  assert.match(html, new RegExp(RESUME));
  assert.match(html, /未在录音/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /backend/i);
  assert.doesNotMatch(html, /正在收尾/);
});

test("a connected call in progress shows neither the banner nor wrapping-up", () => {
  const html = render(props({ status: "connected", isCapturing: true }));

  assert.doesNotMatch(html, new RegExp(PAUSED_BANNER));
  assert.doesNotMatch(html, /正在收尾/);
});

test("a connecting call does not claim that a connection was lost", () => {
  const html = render(props({ status: "connecting", isStarting: true }));

  assert.match(html, /正在连接/);
  assert.doesNotMatch(html, new RegExp(PAUSED_BANNER));
  assert.doesNotMatch(html, /role="alert"/);
});

test("a degraded call says recording continues before describing the impact", () => {
  const html = render(
    props({
      status: "connected",
      isCapturing: true,
      activity: {
        session_id: "s1",
        at: new Date(0).toISOString(),
        agents: [],
        call: {
          privacy_first: false,
          degraded: true,
          degraded_reasons: [
            "Live processing is falling behind. Some transcript text or speaker labels may be missing.",
          ],
          gateway: { state: "ok", detail: "" },
          transcription: { jobs: 0, failed: 0, last_error: "" },
          diarization: { queued: 1, shed: 12 },
        },
      },
    }),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /录音仍在继续/);
  assert.doesNotMatch(html, /audio frames|diarizer|backend/i);
});

test("the pending ask renders above the insight list", () => {
  const src = readFileSync(new URL("./ActiveCallView.tsx", import.meta.url), "utf8");
  assert.match(src, /pendingAsk/);
  assert.ok(
    src.indexOf("pendingAsk") < src.indexOf("<QuestionList"),
    "the pending card must render before the list",
  );
});

test("the bar receives the ask handler and model props", () => {
  const src = readFileSync(new URL("./ActiveCallView.tsx", import.meta.url), "utf8");
  assert.match(src, /onAsk=\{/);
  assert.match(src, /modelId=\{/);
  assert.match(src, /localOnly=\{/);
});

test("the top bar drops the meeting information the operator already entered", () => {
  const html = render(
    props({
      status: "connected",
      isCapturing: true,
      session: {
        ...props().session,
        meeting_type: "client_sales",
        meeting_context: "Renewal call with the platform team",
      },
    }),
  );

  assert.doesNotMatch(html, /Client \/ prospect/);
  assert.doesNotMatch(html, /Conversation type/);
  assert.doesNotMatch(html, /Renewal call with the platform team/);
  // What belongs there stays: the meters, the timer and End Call.
  assert.match(html, /麦克风音量/);
  assert.match(html, /结束通话/);
});

test("a healthy call says it is listening exactly once", () => {
  const html = render(
    props({ status: "connected", isCapturing: true, systemAudioActive: true }),
  );

  // Two meters and a status word used to give the bar three copies of it.
  assert.equal(html.match(/正在监听/g)?.length, 1);
  // Both meters are still there and still distinguishable.
  assert.match(html, /麦克风音量/);
  assert.match(html, /会议音量/);
});

test("a call that is not simply listening still says what it is doing", () => {
  assert.match(render(props({ isStarting: true })), /正在启动音频…/);
  assert.match(render(props({ status: "connecting" })), /正在连接/);
});

test("diagnostics are an unlabeled icon whose readout stays closed", () => {
  const html = render(props({ status: "connected", isCapturing: true }));

  assert.match(html, /aria-label="音频诊断"/);
  // No wide "Debug" pill in the flow of the bar, and no readout until asked.
  assert.doesNotMatch(html, />Debug</);
  assert.doesNotMatch(html, /audio sent:/);
});

test("the transcript column can be put away", () => {
  const html = render(props({ status: "connected", isCapturing: true }));

  assert.match(html, /实时转录/);
  assert.match(html, /隐藏实时转录/);
});

const signalInsight = (id, text, itemType = "signal") => ({
  id,
  session_id: "s1",
  item_type: itemType,
  lens_label: "Risk",
  question: text,
  rationale: "",
  source_context: "",
  directive_id: null,
  starred: false,
  dismissed: false,
  created_at: "2026-08-17T10:00:00Z",
  answered: false,
  answer_summary: "",
  needs_followup: false,
  followup_question: "",
  agent_source: "strategic_signals",
  vote: 0,
});

const signalSynthesis = {
  mode: "live",
  status: "completed",
  strategic_signals: [{ title: "On the panel", priority: 1 }],
  top_outcomes: [],
  top_opportunities: [],
  risks_blockers: [],
  action_plan: [],
  unresolved_discovery_questions: [],
  clusters: [],
  signal_history: [],
  signal_history_count: 0,
  created_at: "2026-08-17T10:00:00Z",
  updated_at: "2026-08-17T10:00:00Z",
};

test("signals that missed the panel are ordinary insight cards", () => {
  const html = render(
    props({
      status: "connected",
      isCapturing: true,
      synthesis: signalSynthesis,
      questions: [
        signalInsight("s-1", "Did not make the panel"),
        signalInsight("s-2", "Aged out last cycle", "signal_history"),
      ],
    }),
  );

  // Listed like any other insight, and each type earns its own chip. The chip
  // label is followed by its count span, so match the label at the chip's
  // text boundary rather than anywhere in the page.
  assert.match(html, /Did not make the panel/);
  assert.match(html, /Aged out last cycle/);
  assert.match(html, />战略信号<span/);
  assert.match(html, />历史信号<span/);
});

test("a signal on the panel is also listed with the other strategic insights", () => {
  const html = render(
    props({
      status: "connected",
      isCapturing: true,
      synthesis: signalSynthesis,
      questions: [signalInsight("s-1", "On the panel."), signalInsight("s-2", "Not on the panel")],
    }),
  );

  // The panel card and its own insight row both render: the Strategic section
  // is the complete strategic picture, panel included. The row keeps its
  // trailing period, so matching it proves the row itself is present rather
  // than only the panel card. (Reverses ALP-308's suppression, by request.)
  assert.match(html, /On the panel\./);
  assert.match(html, /Not on the panel/);
});

test("the auto-prioritize rule is gone: a signal is not force-upvoted", () => {
  const src = readFileSync(new URL("./ActiveCallView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /autoUpvoted/);
  assert.doesNotMatch(src, /getLiveSignalInsightIds/);
});

test("filter chips with nothing behind them are not rendered", () => {
  const html = render(
    props({
      status: "connected",
      isCapturing: true,
      questions: [signalInsight("s-1", "Only a signal here")],
    }),
  );

  // Only All and the one type present; the empty built-ins stay off screen.
  assert.match(html, />全部<span/);
  assert.match(html, />战略信号<span/);
  assert.doesNotMatch(html, />历史信号<span/);
  assert.doesNotMatch(html, />异议<span/);
  assert.doesNotMatch(html, />机会<span/);
  assert.doesNotMatch(html, />已回答<span/);
});

test("the Strategic chip stays hidden when no signal has been captured", () => {
  const html = render(props({ status: "connected", isCapturing: true }));

  // The All chip proves the strip rendered, so the absences below are real.
  assert.match(html, />全部<span/);
  assert.doesNotMatch(html, />战略信号<span/);
  assert.doesNotMatch(html, />历史信号<span/);
});
