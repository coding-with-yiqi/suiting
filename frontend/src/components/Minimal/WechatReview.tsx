import { useEffect, useRef, useState } from "react";
import { request } from "../../services/api";

interface Target { id: string; name: string }
interface Receipt { name: string; state: "sent" | "failed" | "unknown" | "pending"; message: string }
interface Review { configured: boolean; targets: Target[]; receipts: Record<string, Receipt> }
interface Props { sessionId: string; questionId: string; text: string; onClose: () => void }
const labels = { sent: "已发送", failed: "发送失败", unknown: "请先核对微信", pending: "发送中或待核对" };
const blocked = (receipt?: Receipt) => receipt && receipt.state !== "failed";
const errorText = (error: unknown) => error instanceof Error ? error.message.replace(/^API error \d+: /, "") : "暂时无法连接，请稍后重试。";
const headers = { "Content-Type": "application/json", "X-Rebroadcast-Review": "1" };

export function WechatReview({ sessionId, questionId, text, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Review>({ configured: false, targets: [], receipts: {} });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const path = `/sessions/${sessionId}/questions/${questionId}/wechat`;
  const eligible = selected.filter(id => !blocked(data.receipts[id]));
  useEffect(() => {
    dialog.current?.showModal();
    let current = true;
    request<Review>(path).then(value => { if (current) setData(value); })
      .catch(error => { if (current) setMessage(errorText(error)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path]);
  async function refresh() {
    setBusy(true); setChecked(false); setMessage("");
    try {
      const targets = await request<Target[]>(`${path}/groups`, { method: "POST", headers });
      setData(previous => ({ ...previous, targets })); setSelected([]);
      setMessage("群列表已更新，请重新勾选本次要发送的群。");
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  async function send() {
    if (busy || !checked || !eligible.length) return;
    setBusy(true); setMessage("");
    try {
      const receipts = await request<Record<string, Receipt>>(path, {
        method: "POST", headers, body: JSON.stringify({ content: text, targets: eligible, reviewed: true }),
      });
      setData(previous => ({ ...previous, receipts }));
      setMessage("本次发送已结束，请查看每个会话的结果。");
    } catch (error) {
      setMessage(`${errorText(error)} 请先查看下方记录和微信，避免重复发送。`);
      try { setData(await request<Review>(path)); }
      catch { setLoading(true); setMessage("暂时无法核对发送结果。请先查看微信，再重新打开审核窗口。"); }
    } finally { setBusy(false); setChecked(false); setSelected([]); }
  }
  return <dialog ref={dialog} className="mr-wechat" aria-labelledby="wechat-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="mr-wechat-head"><div><span className="mr-eyebrow">人工审核后发送</span><h2 id="wechat-title">核对正文，再选发送的群。</h2></div><button disabled={busy} onClick={onClose} aria-label="关闭审核窗口">关闭</button></div>
    <p className="mr-note">以下正文会原样发送。需要修改时，请返回文案卡片，保存后再审核。</p>
    <div className="mr-wechat-preview"><p className="mr-copy-text">{text}</p></div>
    {loading ? <p role="status">正在读取连接和发送记录…</p> : !data.configured ? <p className="mr-alert">尚未连接微信，请先配置 GeWe。文案可以继续复制使用。</p> : <>
      <div className="mr-section-title"><h3>发送到哪些群</h3><button disabled={busy} onClick={refresh}>刷新微信群</button></div>
      <p className="mr-note">群列表来自微信中已保存到通讯录的群。找不到时，先在手机上把该群保存到通讯录，再刷新。</p>
      <input aria-label="搜索群名" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="搜索群名" />
      <div className="mr-wechat-targets">{data.targets.filter(target => target.name.toLowerCase().includes(search.toLowerCase())).map(target => <label key={target.id} className="mr-checkbox mr-wechat-target">
        <input type="checkbox" checked={selected.includes(target.id)} disabled={busy || Boolean(blocked(data.receipts[target.id]))} onChange={event => { setSelected(previous => event.target.checked ? [...previous, target.id] : previous.filter(id => id !== target.id)); setChecked(false); }} />
        <span>{target.name}{data.receipts[target.id] && <small>{labels[data.receipts[target.id].state]} · {data.receipts[target.id].message}</small>}</span>
      </label>)}</div>
      {data.targets.length === 1 && <p className="mr-note">先用文件传输助手试发；点击“刷新微信群”加载可选的群。</p>}
      <div className="mr-wechat-confirm"><strong>本次选择：{eligible.length ? data.targets.filter(target => eligible.includes(target.id)).map(target => target.name).join("、") : "尚未选择"}</strong>
        <label className="mr-checkbox"><input type="checkbox" checked={checked} disabled={busy || !eligible.length} onChange={event => setChecked(event.target.checked)} />我已核对正文和发送目标</label>
        <button className="mr-primary" disabled={busy || !checked || !eligible.length} onClick={send}>{busy ? "正在处理，请稍候…" : `确认发送（${eligible.length} 个会话）`}</button>
      </div>
      <p className="mr-note">同一版文案不会重复发到已成功的群。修改正文后，会按新消息处理。</p>
    </>}
    {message && <p className="mr-alert" role="status">{message}</p>}
    {Object.keys(data.receipts).length > 0 && <section aria-label="各会话发送结果"><h3>发送记录</h3>{Object.entries(data.receipts).map(([id, receipt]) => <div className="mr-wechat-result" key={id}><strong>{receipt.name} · {labels[receipt.state]}</strong><p>{receipt.message}</p></div>)}</section>}
  </dialog>;
}
