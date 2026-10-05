import { useEffect, useState } from "react";
import type { AudioLevelSource } from "../../hooks/useAudioCapture";
import type { CallSegment, Question, Session, TranscriptEntry } from "../../types";
import * as api from "../../services/api";
import { saveWritingProfile, styleFromPrompt, writingErrorMessage } from "../../services/rebroadcast";
import "./minimal.css";
import { WechatReview } from "./WechatReview";
import { NewBroadcast } from "./NewBroadcast";
import { ModelConnection } from "./ModelConnection";

type Page = "current" | "history" | "style" | "connect";
interface Props {
  sessions: Session[]; session: Session | null; questions: Question[];
  transcripts: TranscriptEntry[]; segments: CallSegment[];
  recording: boolean; systemActive: boolean; level: AudioLevelSource;
  connected: boolean; busy: boolean; ending: boolean; error: string | null;
  writingError: string | null;
  microphone: boolean; onMicrophone: (value: boolean) => void;
  onCreate: (name: string, context: string) => Promise<void>; onSelect: (id: string) => void;
  onStart: () => Promise<void>; onEnd: () => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onContext: (text: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}
const time = (date: string) => new Date(date).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

function SoundStatus({ recording, systemActive, connected, level }: Pick<Props, "recording" | "systemActive" | "connected" | "level">) {
  const [volume, setVolume] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setVolume(level.current), 250); return () => clearInterval(timer); }, [level]);
  const ready = recording && systemActive && connected;
  return <div className="mr-sound" role="status"><span className={ready ? "mr-dot on" : "mr-dot"} />
    <strong>{!recording ? "尚未收音" : !connected ? "连接已断开，录音未送达" : !systemActive ? "电脑声音已断开" : volume > .025 ? "正在收到电脑声音" : "已接通，当前声音较轻"}</strong>
    <span className="mr-meter" aria-hidden="true"><i style={{ width: `${Math.max(3, volume * 100)}%` }} /></span>
  </div>;
}
function CopyCard({ item, onDismiss }: { item: Question; onDismiss: Props["onDismiss"] }) {
  const key = `rebroadcast:edited:${item.id}`;
  const [text, setText] = useState(() => localStorage.getItem(key) ?? item.question);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNote("已复制，可以去群里粘贴。"); }
    catch { setEditing(true); setNote("复制未成功，请选中文字手动复制。"); }
  }
  async function save() {
    setSaving(true);
    try {
      await api.updateQuestion(item.session_id, item.id, { question: text });
      localStorage.removeItem(key);
      setEditing(false); setNote("修改已随本场记录保存。");
    } catch { setNote("保存失败，修改还在这里。请重试，或先复制文案。"); }
    finally { setSaving(false); }
  }
  return <article className="mr-card mr-copy"><div className="mr-eyebrow">候选文案 · {time(item.created_at)}</div>
    {editing ? <textarea aria-label="修改文案" value={text} disabled={saving} maxLength={12000} onChange={(e) => setText(e.target.value)} rows={8} /> : <p className="mr-copy-text">{text}</p>}
    <div className="mr-actions"><button className="mr-primary" onClick={copy}>复制文案</button>
      <button disabled={editing || saving || !text.trim()} onClick={() => setReviewing(true)}>审核并发送</button>
      <button disabled={saving || (editing && !text.trim())} onClick={() => editing ? save() : setEditing(true)}>{saving ? "正在保存…" : editing ? "保存修改" : "修改"}</button>
      <button className="mr-text-button" onClick={() => void onDismiss(item.id).catch(() => setNote("暂时没能移除，请重试。"))}>移除候选</button></div>
    <div role="status" className="mr-note">{note}</div>
    {item.source_context && <details><summary>查看对应原文</summary><p>{item.source_context}</p></details>}
    {reviewing && <WechatReview sessionId={item.session_id} questionId={item.id} text={text} onClose={() => setReviewing(false)} />}
  </article>;
}
function WritingStyle({ active }: { active: boolean }) {
  const [samples, setSamples] = useState(""); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { api.listAgents().then((agents) => setSamples(styleFromPrompt(agents.find((a) => a.slug === "consolidated_analyst")?.prompt ?? ""))).catch(() => setMessage("未能读取已保存的范例，请稍后重试。")).finally(() => setLoading(false)); }, []);
  async function save() {
    setBusy(true);
    try { await saveWritingProfile(samples); setMessage("已记住，下次开始录音时使用。当前写作模型保持不变。"); }
    catch (e) { setMessage(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="mr-card"><span className="mr-eyebrow">常用写法</span><h2>先让人停下来，再给一个去听的理由。</h2>
    <p>沿用你给的群文案：先用反差、提问或鲜活细节抓住人，再给一点具体内容，把值得来听的部分留在现场。</p>
    <p>已内置多组“听到什么 → 怎么写”的示范，AI 可以照着写。</p>
    <p>没有值得转播的新内容就等一等。姓名、数字和结果以实际原文为准。</p>
    <label htmlFor="mr-samples">还想补充的好文案</label><textarea id="mr-samples" rows={9} value={samples} disabled={loading || active} onChange={(e) => setSamples(e.target.value)} placeholder="把你喜欢的群消息粘贴到这里。不同范例之间空一行。" />
    <button className="mr-primary" disabled={busy || loading || active} onClick={save}>{busy ? "正在保存…" : "记住这些范例"}</button>
    <p className="mr-note" role="status">{active ? "本场录音结束后可以更新范例。" : message}</p>
  </section>;
}
export function MinimalWorkspace(props: Props) {
  const [page, setPage] = useState<Page>("current"); const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(""); const [name, setName] = useState(""); const [context, setContext] = useState("");
  const s = props.session; const active = props.recording || props.sessions.some((session) => session.state === "active");
  useEffect(() => { setName(s?.name ?? ""); setContext(s?.meeting_context ?? ""); }, [s?.id]);
  const posts = props.questions.filter((q) => q.item_type === "community_post" && !q.dismissed);
  async function run(operation: () => Promise<void>) {
    setBusy(true); setNotice(""); try { await operation(); } catch { setNotice("操作暂时没完成，请确认本机程序仍在运行后重试。"); } finally { setBusy(false); }
  }
  return <div className="mr-app"><header className="mr-header"><a className="mr-brand" href="#" onClick={(e) => { e.preventDefault(); setPage("current"); }}>随听<span>把正在讲的，写给群里的人。</span></a>
    <nav aria-label="主导航">{([["current", "本场"], ["history", "历史记录"], ["style", "好文案"], ["connect", "连接 AI"]] as const).map(([id, label]) => <button key={id} aria-current={page === id ? "page" : undefined} onClick={() => setPage(id)}>{label}</button>)}</nav></header>
    <main className="mr-main">
      {page === "connect" ? <ModelConnection active={active} /> : page === "style" ? <WritingStyle active={active} /> : page === "history" ? <><h1>留下每一场的内容。</h1><div className="mr-history">{props.sessions.length === 0 && <p>开始第一场录音后，记录会出现在这里。</p>}{props.sessions.map((item) => <button className="mr-card" key={item.id} onClick={() => { props.onSelect(item.id); setPage("current"); }}><span className="mr-eyebrow">{new Date(item.created_at).toLocaleDateString("zh-CN")} · {item.state === "completed" ? "已结束" : item.state === "active" ? "进行中" : "未开始"}</span><h2>{item.name}</h2><p>查看文案、原文与录音 →</p></button>)}</div></> : creating ? <NewBroadcast microphone={props.microphone} onMicrophone={props.onMicrophone} onCancel={() => setCreating(false)} onCreate={async (title, details) => { await props.onCreate(title, details); setCreating(false); setNotice("本场信息已保存，准备好后点“去听电脑声音”。"); }} /> : <>
        <div className="mr-title"><div><span className="mr-eyebrow">电脑声音 → 原文 → 群转播</span><h1>{s?.name ?? "好内容，随听随转播。"}</h1></div><button disabled={busy || active || props.busy} onClick={() => { setNotice(""); setCreating(true); }}>新建一场</button></div>
        {!s ? <section className="mr-card mr-empty"><h2>先打开你要听的直播或会议。</h2><p>新建一场后开始收音，原文和可发群的文案会陆续出现在这里。</p><p className="mr-note">当前版本通过浏览器共享电脑声音。开始时请选含音频的来源；授权后可以切回直播。</p></section> : <>
          <section className="mr-card mr-recorder"><SoundStatus {...props} /><div className="mr-actions">
            {s.state !== "completed" && <button className="mr-primary" disabled={busy || props.busy || props.ending} onClick={() => run(props.onStart)}>{props.busy ? "正在接入声音…" : props.recording ? "重新接入声音" : "去听电脑声音"}</button>}
            {s.state === "active" && <button disabled={props.ending || busy} onClick={() => run(props.onEnd)}>{props.ending ? "正在保存…" : "结束并保存"}</button>}
            {s.state === "completed" && <span className="mr-note">本场已结束，录音与原文保留在下面。</span>}
          </div>{s.state === "pre_call" && <><label className="mr-checkbox"><input type="radio" name="session-sound" checked readOnly />去听电脑里正在播放的声音（默认）</label><label className="mr-checkbox"><input type="checkbox" checked={props.microphone} onChange={(e) => props.onMicrophone(e.target.checked)} />同时录下我说的话</label><p className="mr-note">在共享窗口中开启音频。没有接到电脑声音时不会开始。</p></>}
            {props.error && <div className="mr-alert" role="alert"><p>收音或转写需要处理。请查看原因后重试。</p><details><summary>查看原因</summary><p>{props.error}</p></details></div>}
          </section>
          {s.state === "pre_call" && <details className="mr-card" open><summary>本场信息 · 可随时修改</summary><label htmlFor="mr-name">这场的名字</label><input id="mr-name" value={name} onChange={(e) => setName(e.target.value)} /><label htmlFor="mr-context">直播入口、听众和嘉宾称呼</label><textarea id="mr-context" rows={4} value={context} onChange={(e) => setContext(e.target.value)} placeholder="有直播链接或本场背景时粘贴到这里。" /><button disabled={busy || !name.trim()} onClick={() => run(async () => { await props.onRename(name.trim()); await props.onContext(context); setNotice("本场信息已保存。"); })}>保存修改</button></details>}
          <div className="mr-section-title"><h2>可发群的文案</h2><span className="mr-note" aria-live="polite">{s.state === "active" && props.recording && props.connected ? `已生成 ${posts.length} 条，持续更新中` : posts.length ? `共 ${posts.length} 条候选，先审核，再选择要发送的群。` : "先审核，再选择要发送的群。"}</span></div>
          {props.writingError && <div className="mr-alert" role="alert">{writingErrorMessage(props.writingError)}</div>}
          {posts.length ? posts.map((item) => <CopyCard key={item.id} item={item} onDismiss={props.onDismiss} />) : <section className="mr-card mr-empty"><h3>{s.state === "completed" ? "本场还没有群文案" : "有值得转播的内容，就会出现在这里。"}</h3><p>先记下原话，等事情讲清楚，再写成一条群消息。</p></section>}
          <details className="mr-card"><summary>原文与录音 <span className="mr-note">{props.transcripts.length} 段原文</span></summary>
            {props.segments.filter((segment) => segment.audio_path && segment.ended_at).map((segment) => <div className="mr-audio" key={segment.id}><p>录音 {segment.segment_number}</p><audio controls preload="none" src={`/api/sessions/${s.id}/segments/${segment.segment_number}/audio`} /><a download href={`/api/sessions/${s.id}/segments/${segment.segment_number}/audio`}>保存录音</a></div>)}
            {!props.transcripts.length && <p className="mr-note">还没有转写文字。</p>}{props.transcripts.map((entry, index) => <p className="mr-transcript" key={entry.id ?? index}><time>{time(entry.timestamp)}</time>{entry.text}</p>)}
          </details>
        </>}
      </>}
      {notice && <p role="status" className="mr-notice">{notice}</p>}
    </main><footer className="mr-footer">随听 · 基于 <a href="https://github.com/talberthoule/backchannel" target="_blank" rel="noreferrer">Backchannel</a> 改造 · <a href="https://doc.geweapi.com/" target="_blank" rel="noreferrer">GeWe 文档</a></footer></div>;
}
