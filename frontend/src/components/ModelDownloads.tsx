import type { ModelDownload } from "../types";

/**
 * What the app is fetching, said out loud.
 *
 * Model weights arrive on first use and can be hundreds of megabytes. Before
 * v0.6.2 that happened with no indication anywhere, so a slow fetch was
 * indistinguishable from a hang and a failed one from a feature that simply
 * did not work (ALP-373). Nothing downloads invisibly now.
 */

const smallButton = "min-h-8 shrink-0 rounded-lg border border-brand-light-gray-1 px-2.5 py-1 font-body text-xs font-semibold text-brand-dark-gray transition-colors motion-reduce:transition-none hover:border-brand-teal hover:text-brand-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal-light focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function bytes(value = 0): string {
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

/** One line describing where a download has got to. */
export function downloadProgressText(download: ModelDownload): string {
  if (download.state === "queued") return "等待开始";
  if (download.state === "installed") return "已安装";
  if (download.state === "error") return download.error || "下载失败";
  if (download.total > 0) {
    return `已下载 ${bytes(download.downloaded)} / 共 ${bytes(download.total)}`;
  }
  // No total: onnx-asr does not report one, so say what has arrived.
  return download.downloaded > 0 ? `已下载 ${bytes(download.downloaded)}` : "正在开始";
}

export function downloadHeadline(download: ModelDownload): string {
  const what = download.purpose ? `${download.label} (${download.purpose})` : download.label;
  switch (download.state) {
    case "queued":
      return `排队等待：${what}`;
    case "downloading":
      return download.percent === null
        ? `正在下载：${what}`
        : `正在下载：${what} - ${download.percent}%`;
    case "installed":
      return `已安装：${what}`;
    default:
      return `无法下载：${what}`;
  }
}

/** The inline row used inside settings cards. */
export function ModelDownloadRow({
  download,
  onRetry,
  onDismiss,
  busy,
}: {
  download: ModelDownload;
  onRetry?: (key: string) => void;
  onDismiss?: (key: string) => void;
  busy?: boolean;
}) {
  const failed = download.state === "error";
  const running = download.state === "queued" || download.state === "downloading";
  return (
    <div className="mt-2 rounded-lg border border-brand-light-gray-1 bg-brand-light-gray-2/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className={`font-body text-xs font-semibold ${failed ? "text-red-700" : "text-brand-dark-gray"}`}>
          {downloadHeadline(download)}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {failed && onRetry && (
            <button type="button" className={smallButton} disabled={busy} onClick={() => onRetry(download.key)}>
              重试
            </button>
          )}
          {!running && onDismiss && (
            <button type="button" className={smallButton} disabled={busy} onClick={() => onDismiss(download.key)}>
              忽略
            </button>
          )}
        </div>
      </div>
      <p className={`mt-1 font-mono text-[11px] ${failed ? "text-red-700" : "text-brand-mid-gray"}`}>
        {downloadProgressText(download)}
      </p>
      {download.state === "downloading" && (
        <progress
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-brand-light-gray-1 [&::-webkit-progress-value]:bg-brand-teal [&::-moz-progress-bar]:bg-brand-teal"
          value={download.percent ?? undefined}
          max={100}
        />
      )}
    </div>
  );
}

/**
 * The floating banner, shown wherever the user happens to be.
 *
 * Downloads start from places the user is not looking at (a background warm-up
 * at startup, the first local transcription of a call), so the notice has to
 * follow them rather than live only in the settings card that triggered it.
 */
export function ModelDownloadsBanner({
  active,
  failed,
  onOpenSettings,
  onRetry,
  onDismiss,
}: {
  active: ModelDownload[];
  failed: ModelDownload[];
  onOpenSettings?: () => void;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
}) {
  const shown = [...active, ...failed];
  if (shown.length === 0) return null;

  return (
    <div className="rounded-xl bg-surface px-4 py-3 shadow-lg ring-1 ring-brand-light-gray-1">
      <div className="flex items-center justify-between gap-3">
        <p className="font-body text-sm font-semibold text-brand-dark-gray">
          {active.length > 0 ? "正在下载模型" : "模型下载失败"}
        </p>
        {onOpenSettings && (
          <button type="button" className={smallButton} onClick={onOpenSettings}>
            设置
          </button>
        )}
      </div>
      <p className="mt-1 font-body text-xs text-brand-mid-gray">
        {active.length > 0
          ? "随听 正在下载所需模型。你可以继续工作，模型到位后相关功能会自动开启。"
          : "需要该模型的功能仍可继续使用，但识别范围会有所减少。"}
      </p>
      {shown.map((download) => (
        <ModelDownloadRow
          key={download.key}
          download={download}
          onRetry={onRetry}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
