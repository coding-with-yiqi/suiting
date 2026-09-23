import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  DesktopUpdateController,
  DesktopUpdateStatus,
} from "../types";

const primaryButton = "min-h-11 rounded-lg bg-brand-teal px-4 py-2 font-body text-sm font-semibold text-white transition-colors motion-reduce:transition-none hover:bg-brand-teal-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-light focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-brand-light-gray-1 disabled:text-brand-mid-gray";
const secondaryButton = "min-h-11 rounded-lg border border-brand-light-gray-1 px-4 py-2 font-body text-sm font-semibold text-brand-dark-gray transition-colors motion-reduce:transition-none hover:border-brand-teal hover:text-brand-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-light focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function bytes(value = 0): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  const digits = amount >= 10 || Number.isInteger(amount) ? 0 : 1;
  return `${amount.toFixed(digits)} ${unit}`;
}

function progressText(status: DesktopUpdateStatus): string {
  return `${bytes(status.downloaded)} / ${bytes(status.size)}`;
}

function DesktopUpdateTransferBody({
  update,
  version,
}: {
  update: DesktopUpdateController;
  version: string;
}) {
  const { status } = update;
  switch (status.state) {
    case "needs_authorization":
      return (
        <div className="space-y-3">
          <div>
            <p className="font-body text-sm font-semibold text-brand-dark-gray">
              下载中断
            </p>
            <p className="mt-1 font-mono text-xs text-brand-mid-gray">{progressText(status)}</p>
          </div>
          <button type="button" onClick={() => void update.download()} className={primaryButton}>
            继续下载
          </button>
        </div>
      );
    case "downloading":
      return (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-body text-sm font-semibold text-brand-dark-gray">
              正在下载 {version}
            </p>
            <span className="font-mono text-xs text-brand-mid-gray">{progressText(status)}</span>
          </div>
          <progress
            className="h-2 w-full overflow-hidden rounded-full accent-brand-teal"
            value={status.downloaded || 0}
            max={status.size || 1}
          />
          <button type="button" onClick={() => void update.cancel()} className={secondaryButton}>
            取消
          </button>
        </div>
      );
    case "ready": {
      const blocked = status.blocked_reason || "";
      return (
        <div className="space-y-3">
          <div>
            <p className="font-body text-sm font-semibold text-brand-dark-gray">
              {version} 已准备好安装
            </p>
            <p className="mt-1 font-body text-xs text-brand-mid-gray">
              随听 会关闭当前窗口，安装更新后自动重新打开。
            </p>
            {blocked && (
              <p className="mt-2 rounded-lg bg-brand-light-gray-2 px-3 py-2 font-body text-xs text-brand-dark-gray">
                请先完成“{blocked}”，再安装更新。
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!!blocked}
            onClick={() => void update.apply()}
            className={primaryButton}
          >
            重启并安装
          </button>
        </div>
      );
    }
    case "applying":
      return (
        <p className="font-body text-sm text-brand-gray">
          正在关闭窗口并安装 {version}……
        </p>
      );
    case "error": {
      const error = (status.error || "更新操作无法完成。").slice(0, 240);
      return (
        <div className="space-y-3">
          <p role="alert" className="rounded-lg bg-brand-light-gray-2 px-3 py-2 font-body text-sm text-brand-dark-gray">
            {error}
          </p>
          <button type="button" onClick={() => void update.check()} className={secondaryButton}>
            重试
          </button>
        </div>
      );
    }
    default:
      return null;
  }
}

function DesktopUpdateBody({ update }: { update: DesktopUpdateController }) {
  const { status } = update;
  const version = status.available_version || "最新版本";

  switch (status.state) {
    case "idle":
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-body text-sm text-brand-gray">随听的底层组件已是最新版本。</p>
          <button type="button" onClick={() => void update.check()} className={secondaryButton}>
            检查更新
          </button>
        </div>
      );
    case "checking":
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-body text-sm text-brand-gray">正在检查更新……</p>
          <button type="button" disabled className={secondaryButton}>
            正在检查更新
          </button>
        </div>
      );
    case "available":
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-body text-sm font-semibold text-brand-dark-gray">
              发现新版本 {version}
            </p>
            <span className="font-mono text-xs text-brand-mid-gray">{bytes(status.size)}</span>
          </div>
          <button type="button" onClick={() => void update.download()} className={primaryButton}>
            下载更新
          </button>
          {status.available_notes && (
            <details className="rounded-lg bg-brand-light-gray-2/60 px-4 py-3">
              <summary className="cursor-pointer font-body text-sm font-semibold text-brand-dark-gray">
                查看更新内容
              </summary>
              <div className="chat-markdown mt-3 border-t border-brand-light-gray-1/70 pt-3 font-body text-sm text-brand-dark-gray">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{status.available_notes}</ReactMarkdown>
              </div>
            </details>
          )}
        </div>
      );
    default:
      return <DesktopUpdateTransferBody update={update} version={version} />;
  }
}

export function DesktopUpdateCard({ update }: { update: DesktopUpdateController }) {
  const { status } = update;
  if (!status.enabled) return null;

  return (
    <section className="rounded-xl bg-surface p-5 shadow-sm ring-1 ring-brand-light-gray-1/60" aria-labelledby="desktop-update-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="desktop-update-title" className="font-display text-base font-semibold text-brand-dark-gray">
            软件更新
          </h2>
          <p className="mt-1 font-body text-xs text-brand-mid-gray">
            安装前会验证更新；如果新版本无法启动，会自动恢复原版本。
          </p>
        </div>
        {status.current_version && (
          <span className="rounded-full bg-brand-light-gray-2 px-2.5 py-1 font-mono text-xs font-medium text-brand-gray">
            当前版本 {status.current_version}
          </span>
        )}
      </div>
      <div className="mt-4" aria-live="polite">
        <DesktopUpdateBody update={update} />
      </div>
    </section>
  );
}

export function DesktopUpdateBanner({
  status,
  onOpen,
}: {
  status: DesktopUpdateStatus;
  onOpen: () => void;
}) {
  if (!["available", "downloading", "ready"].includes(status.state)) return null;
  const version = status.available_version || "更新";
  const percent = status.size
    ? Math.min(100, Math.round(((status.downloaded || 0) / status.size) * 100))
    : 0;
  const message = status.state === "available"
    ? `发现新版本 ${version}`
    : status.state === "ready"
      ? `${version} 已准备好安装`
      : `正在下载 ${version} - ${percent}%`;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 shadow-lg ring-1 ring-brand-light-gray-1">
      <p className="font-body text-sm text-brand-dark-gray">{message}</p>
      <button
        type="button"
        onClick={onOpen}
        className="min-h-11 shrink-0 rounded-lg bg-brand-teal px-3 py-2 font-body text-xs font-semibold text-white transition-colors motion-reduce:transition-none hover:bg-brand-teal-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-light focus-visible:ring-offset-2"
      >
        查看更新
      </button>
    </div>
  );
}
