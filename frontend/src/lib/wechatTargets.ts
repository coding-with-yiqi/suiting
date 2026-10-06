export interface WechatTargetRef {
  id: string;
  name: string;
}

/** Read a stored default list without allowing malformed browser storage to break review. */
export function parseDefaultTargetIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
  } catch {
    return [];
  }
}

/** Apply defaults only to groups that are currently available from GeWe. */
export function selectAvailableDefaults(defaultIds: string[], targets: WechatTargetRef[]): string[] {
  const available = new Set(targets.map((target) => target.id));
  return defaultIds.filter((id) => available.has(id));
}

/** Keep this message's temporary additions/removals when the group list refreshes. */
export function keepAvailableSelection(selected: string[], targets: WechatTargetRef[]): string[] {
  const available = new Set(targets.map((target) => target.id));
  return selected.filter((id) => available.has(id));
}
