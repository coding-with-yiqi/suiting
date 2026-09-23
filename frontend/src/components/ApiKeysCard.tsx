import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "./ConfirmProvider";
import * as api from "../services/api";
import type { CredentialInfo } from "../services/api";

// Self-hosted servers are configured per endpoint in EndpointsCard, not as a
// single workspace-wide key, so that provider is not listed here.
const COMPATIBLE = api.OPENAI_COMPATIBLE_PROVIDER;

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google (Gemini)",
  openai: "OpenAI",
};

// Direct links to each provider's key-creation page so users never hunt
// through console menus.
const PROVIDER_KEY_PAGES: Record<string, string> = {
  google: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
};

interface ApiKeysCardProps {
  onChanged?: () => void;
}

// The backend answers a save with 503 when the credentials master key cannot
// be used (an unwrappable DPAPI blob after a password reset, a corrupt file);
// its detail carries the recovery steps, so show that text rather than the
// "API error 503:" prefix the client wraps every failure in.
export function describeKeyError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  return err.message.replace(/^API error \d+:\s*/, "") || fallback;
}

export default function ApiKeysCard({ onChanged }: ApiKeysCardProps) {
  const { confirm, toast } = useConfirm();
  const [credentials, setCredentials] = useState<CredentialInfo[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const load = useCallback(async () => {
    try {
      const all = await api.listCredentials();
      setCredentials(all.filter((cred) => cred.provider !== COMPATIBLE));
    } catch (err) {
      console.error("Failed to load credentials", err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setResult = (provider: string, ok: boolean, message: string) =>
    setResults((prev) => ({ ...prev, [provider]: { ok, message } }));

  const handleSave = async (provider: string) => {
    const key = (inputs[provider] || "").trim();
    if (!key) return;
    setBusy(provider);
    try {
      const saved = await api.saveCredential(provider, key);
      setInputs((prev) => ({ ...prev, [provider]: "" }));
      setResult(provider, saved.connected, saved.message ?? "已保存");
      await load();
      onChanged?.();
    } catch (err) {
      setResult(provider, false, describeKeyError(err, "保存失败"));
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (provider: string) => {
    setBusy(provider);
    try {
      const res = await api.testCredential(provider);
      setResult(provider, res.ok, res.message);
      await load();
      onChanged?.();
    } catch (err) {
      setResult(provider, false, describeKeyError(err, "测试失败"));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (provider: string) => {
    const ok = await confirm({
      title: "删除 API 密钥",
      message: `要删除已保存的 ${provider} 密钥吗？依赖它的实时转文字和分析会停止，直到重新添加密钥。`,
      confirmLabel: "删除密钥",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(provider);
    try {
      await api.deleteCredential(provider);
      setResult(provider, true, "已删除");
      toast(`已删除 ${provider} 密钥`);
      await load();
      onChanged?.();
    } catch (err) {
      setResult(provider, false, describeKeyError(err, "删除失败"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl bg-surface p-5 shadow-sm">
      <h3 className="font-display text-base font-bold text-brand-dark-gray">云端服务密钥</h3>
      <p className="mt-1 mb-4 font-body text-xs text-brand-gray leading-relaxed">
        密钥会加密保存在这台电脑上，所有分析助手都可以使用。也可以使用系统环境变量作为备用。
        自己电脑上的模型服务在下面设置，通常不需要密钥。
      </p>
      <div className="space-y-4">
        {credentials.map((cred) => {
          const isBusy = busy === cred.provider;
          const result = results[cred.provider];
          return (
            <div key={cred.provider} className={`transition-opacity ${isBusy ? "opacity-70" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <label className="font-body text-xs font-medium text-brand-gray">
                  {PROVIDER_LABELS[cred.provider] || cred.provider}
                </label>
                {cred.configured || cred.env_fallback ? (
                  <>
                    <span className="inline-flex rounded-full bg-brand-teal px-2 py-0.5 text-[10px] font-medium text-white">
                      {cred.masked || "已设置密钥"}
                    </span>
                    {cred.env_fallback && (
                      <span className="inline-flex rounded-full bg-brand-light-gray-1 px-2 py-0.5 text-[10px] font-medium text-brand-dark-gray">
                        系统变量
                      </span>
                    )}
                    <span
                      className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                      style={{ backgroundColor: cred.connected ? "#72d54a" : "#ff9e16" }}
                      title={cred.connected ? "这个密钥已通过连接测试" : "请点击“测试”验证密钥；未验证或验证失败会停用该服务商的模型"}
                    >
                      {cred.connected ? "已连接" : "未验证"}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex rounded-full bg-brand-light-gray-1 px-2 py-0.5 text-[10px] font-medium text-brand-dark-gray">
                    未设置
                  </span>
                )}
                {PROVIDER_KEY_PAGES[cred.provider] && (
                  <a
                    href={PROVIDER_KEY_PAGES[cred.provider]}
                    target="_blank"
                    rel="noreferrer"
                    className="font-body text-[10px] font-medium text-brand-teal hover:underline"
                  >
                    获取密钥
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-label={`${PROVIDER_LABELS[cred.provider] || cred.provider} API 密钥`}
                  placeholder={cred.configured ? "替换现有密钥……" : "粘贴 API 密钥……"}
                  value={inputs[cred.provider] || ""}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [cred.provider]: e.target.value }))}
                  className="w-full max-w-md rounded border border-brand-light-gray-1 bg-surface px-3 py-1.5 font-mono text-sm text-brand-dark-gray focus:border-brand-teal"
                />
                <button
                  onClick={() => handleSave(cred.provider)}
                  disabled={isBusy || !(inputs[cred.provider] || "").trim()}
                  className="rounded bg-brand-teal px-3 py-1.5 font-body text-xs font-medium text-white transition-opacity disabled:opacity-40"
                >
                  保存
                </button>
                <button
                  onClick={() => handleTest(cred.provider)}
                  disabled={isBusy || (!cred.configured && !cred.env_fallback)}
                  className="rounded border border-brand-light-gray-1 px-3 py-1.5 font-body text-xs font-medium text-brand-dark-gray transition-opacity disabled:opacity-40"
                >
                  测试
                </button>
                {cred.configured && (
                  <button
                    onClick={() => handleRemove(cred.provider)}
                    disabled={isBusy}
                    className="rounded px-2 py-1.5 font-body text-xs text-brand-mid-gray hover:text-red-600 transition-colors disabled:opacity-40"
                  >
                    删除
                  </button>
                )}
              </div>
              {result && (
                <p className={`mt-1 font-body text-xs ${result.ok ? "text-brand-teal" : "text-red-600"}`}>
                  {result.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
