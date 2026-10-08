const BUILTIN_CONNECTOR_ICONS: Record<string, string> = {
  "tencent-docs": "/connector-icons/tencent-docs.png",
  "tencent-meeting": "/connector-icons/tencent-meeting.png",
};

export function connectorIconUrl(builtinKey?: string | null): string | null {
  return builtinKey ? BUILTIN_CONNECTOR_ICONS[builtinKey] ?? null : null;
}

export function connectorIconValue(builtinKey: string | null | undefined, fallback: string): string {
  return connectorIconUrl(builtinKey) ?? fallback;
}
