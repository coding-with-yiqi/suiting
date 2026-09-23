import { useState } from "react";

interface CliTool {
  name: string;
  description: string;
  install: string;
  start: string;
  connect?: string;
  docs: string;
}

const TOOLS: CliTool[] = [
  {
    name: "Codex CLI",
    description: "在终端里使用 Codex 检查、修改和运行项目代码。",
    install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    start: "cd 你的项目目录\ncodex",
    connect: "# 也可以按 DeepSeek 官方向导接入 DeepSeek\nbash <(curl -fsSL https://cdn.deepseek.com/api-docs/codex-deepseek-setup-en.sh)",
    docs: "https://developers.openai.com/codex/cli",
  },
  {
    name: "Claude Code",
    description: "在终端里使用 Claude Code 读懂项目、改代码和执行命令。",
    install: "npm install -g @anthropic-ai/claude-code",
    start: "cd 你的项目目录\nclaude",
    connect: "# 连接 DeepSeek 的 Anthropic 兼容接口\nexport ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic\nexport ANTHROPIC_AUTH_TOKEN=你的_DEEPSEEK_API_KEY\nexport ANTHROPIC_MODEL=deepseek-flash\nclaude",
    docs: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
  },
  {
    name: "Kimi Code",
    description: "Kimi 官方的终端编程助手，支持通过 /login 选择 Kimi 平台密钥。",
    install: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    start: "cd 你的项目目录\nkimi",
    connect: "/login\n# 选择 Kimi Platform，然后粘贴 API Key",
    docs: "https://platform.kimi.com/docs/guide/kimi-code-cli",
  },
  {
    name: "Deep Code",
    description: "DeepSeek 官方文档推荐的开源终端编程助手，直接使用 DeepSeek 模型。",
    install: "npm install -g @vegamo/deepcode-cli",
    start: "cd 你的项目目录\ndeepcode",
    connect: "# 首次使用前，在 ~/.deepcode/settings.json 中配置 API_KEY 和 MODEL",
    docs: "https://api-docs.deepseek.com/quick_start/agent_integrations/deepcode/",
  },
  {
    name: "智谱 GLM 编程助手",
    description: "智谱官方的工具配置向导，可帮助配置 Claude Code、OpenCode 等终端工具。",
    install: "npm install -g @z_ai/coding-helper",
    start: "coding-helper init",
    connect: "coding-helper auth glm_coding_plan_china 你的_GLM_CODING_KEY\ncoding-helper doctor",
    docs: "https://docs.bigmodel.cn/cn/coding-plan/extension/coding-tool-helper",
  },
];

function CommandBlock({ value, onCopied }: { value: string; onCopied: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      onCopied();
    } catch {
      // Clipboard access can be blocked by the browser; the command remains selectable.
    }
  };

  return (
    <div className="relative mt-1.5 rounded-lg bg-slate-900 px-3 py-2.5 pr-16">
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-100">{value}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 rounded border border-slate-600 px-2 py-1 font-body text-[10px] text-slate-200 transition-colors hover:border-slate-300 hover:text-white"
      >
        复制
      </button>
    </div>
  );
}

export default function CliToolsCard() {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const notifyCopied = (name: string) => {
    setCopied(name);
    window.setTimeout(() => setCopied((current) => (current === name ? null : current)), 1600);
  };

  return (
    <div className="rounded-xl bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-brand-dark-gray">终端 AI 工具</h3>
          <p className="mt-1 max-w-2xl font-body text-xs leading-relaxed text-brand-gray">
            这些工具可以直接使用你自己的账号或 API 密钥，在终端里检查代码、校对文稿和调用个人知识库。
            随听 不会自动执行下面的命令；复制后粘贴到终端即可。
          </p>
        </div>
        <span className="inline-flex rounded-full border border-brand-teal/30 bg-brand-teal/5 px-2 py-0.5 font-body text-[10px] font-semibold text-brand-teal">
          工具免费安装，模型按账号计费
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {TOOLS.map((tool) => {
          const expanded = open === tool.name;
          return (
            <div key={tool.name} className="rounded-lg border border-brand-light-gray-1">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : tool.name)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-brand-light-gray-2/50"
              >
                <span className="min-w-0">
                  <span className="font-body text-sm font-semibold text-brand-dark-gray">{tool.name}</span>
                  <span className="mt-0.5 block font-body text-xs text-brand-gray">{tool.description}</span>
                </span>
                <span className={`shrink-0 text-brand-mid-gray transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true">›</span>
              </button>
              {expanded && (
                <div className="border-t border-brand-light-gray-1/70 px-3.5 pb-3.5 pt-3">
                  <div>
                    <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-brand-mid-gray">安装</p>
                    <CommandBlock value={tool.install} onCopied={() => notifyCopied(tool.name)} />
                  </div>
                  <div className="mt-3">
                    <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-brand-mid-gray">启动</p>
                    <CommandBlock value={tool.start} onCopied={() => notifyCopied(tool.name)} />
                  </div>
                  {tool.connect && (
                    <div className="mt-3">
                      <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-brand-mid-gray">连接自己的模型</p>
                      <CommandBlock value={tool.connect} onCopied={() => notifyCopied(tool.name)} />
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <a
                      href={tool.docs}
                      target="_blank"
                      rel="noreferrer"
                      className="font-body text-[11px] font-medium text-brand-teal hover:underline"
                    >
                      打开官方说明
                    </a>
                    {copied === tool.name && <span className="font-body text-[11px] text-brand-teal">已复制命令</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[11px] leading-relaxed text-amber-900">
        API 密钥不要发到群里，也不要提交到代码仓库。命令里的“你的_API_KEY”只是占位文字，请替换成自己的密钥。
      </p>
    </div>
  );
}
