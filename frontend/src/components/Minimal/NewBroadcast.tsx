import { useState } from "react";

interface Props {
  microphone: boolean;
  onMicrophone: (value: boolean) => void;
  onCreate: (name: string, context: string) => Promise<void>;
  onCancel: () => void;
}

export function NewBroadcast({ microphone, onMicrophone, onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  const [entry, setEntry] = useState("");
  const [guests, setGuests] = useState("");
  const [audience, setAudience] = useState("");
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    const context = [
      `本场主题：${name.trim()}`,
      live ? "内容状态：实时直播或会议，按当前话题同步转播。" : "内容状态：回放或录音，不使用实时催进入场的说法。",
      entry.trim() && `${live ? "本场直播入口" : "本场回放入口"}：${entry.trim()}`,
      guests.trim() && `嘉宾称呼参考：${guests.trim()}`,
      audience.trim() && `这次想邀请的听众：${audience.trim()}`,
    ].filter(Boolean).join("\n");
    try { await onCreate(name.trim(), context); }
    catch { setError("这场暂时没有建好，填写的内容已保留，请重试。"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={create} className="mr-create">
    <span className="mr-eyebrow">新建一场</span><h1>先告诉随听，这场聊什么。</h1>
    <p>主题必填，其他信息可以稍后补。填写后再开始听，不会立即录音或发消息。</p>
    <fieldset disabled={busy} className="mr-card">
      <legend>本场基本信息</legend>
      <label htmlFor="new-topic">这场的主题</label>
      <input autoFocus id="new-topic" required maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="例如：创始人怎么把 AI 用进业务" />
      <label htmlFor="new-entry">直播入口或会议号（选填）</label>
      <input id="new-entry" maxLength={2000} value={entry} onChange={e => setEntry(e.target.value)} placeholder="例如：#腾讯会议：你的会议号，或完整直播链接" />
      <p className="mr-note">文案末尾会原样带上这个入口。听回放时，请填回放链接。</p>
      <label htmlFor="new-guests">有哪些嘉宾，怎么称呼（选填）</label>
      <input id="new-guests" maxLength={2000} value={guests} onChange={e => setGuests(e.target.value)} placeholder="例如：林老师聊投资，陈老师聊 AI 应用" />
      <label htmlFor="new-audience">希望吸引谁来听（选填）</label>
      <textarea id="new-audience" rows={2} maxLength={3000} value={audience} onChange={e => setAudience(e.target.value)} placeholder="例如：想用 AI 改善业务、但还不知道从哪里入手的创业者" />
      <div className="mr-choice-row" role="group" aria-label="内容状态">
        <label className="mr-checkbox"><input type="radio" name="content-kind" checked={live} onChange={() => setLive(true)} />正在直播或开会</label>
        <label className="mr-checkbox"><input type="radio" name="content-kind" checked={!live} onChange={() => setLive(false)} />回放或录音</label>
      </div>
    </fieldset>
    <fieldset disabled={busy} className="mr-card">
      <legend>听哪里的声音</legend>
      <label className="mr-checkbox"><input type="radio" name="new-sound" checked readOnly />去听电脑里正在播放的声音（默认）</label>
      <p className="mr-note">用于腾讯会议、Zoom、视频号或网页直播。开始时会请你选择共享来源并开启音频。</p>
      <label className="mr-checkbox"><input type="checkbox" checked={microphone} onChange={e => onMicrophone(e.target.checked)} />同时录下我说的话</label>
    </fieldset>
    {error && <p className="mr-alert" role="alert">{error}</p>}
    <div className="mr-actions"><button className="mr-primary" type="submit" disabled={busy || !name.trim()}>{busy ? "正在保存…" : "保存信息，进入本场"}</button><button type="button" disabled={busy} onClick={onCancel}>取消</button></div>
  </form>;
}
