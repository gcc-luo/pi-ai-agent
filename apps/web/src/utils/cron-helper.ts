/** Common cron presets with human-readable labels (Chinese). */
export const cronPresets: Array<{ label: string; expression: string }> = [
  { label: "每 5 分钟", expression: "*/5 * * * *" },
  { label: "每小时", expression: "0 * * * *" },
  { label: "每天 9:00", expression: "0 9 * * *" },
  { label: "每天 18:00", expression: "0 18 * * *" },
  { label: "每周一 9:00", expression: "0 9 * * 1" },
  { label: "每月 1 号 9:00", expression: "0 9 1 * *" },
];

const WEEKDAY_MAP: Record<string, string> = {
  "0": "周日", "1": "周一", "2": "周二", "3": "周三",
  "4": "周四", "5": "周五", "6": "周六", "7": "周日",
};

/**
 * Convert a 5-field cron expression to a human-readable Chinese string.
 * Handles common patterns; falls back to the raw expression for complex ones.
 */
export function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const minute = parts[0]!;
  const hour = parts[1]!;
  const dom = parts[2]!;
  const month = parts[3]!;
  const dow = parts[4]!;

  // Every minute
  if (minute === "*" && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return "每分钟";
  }

  // Every N minutes
  if (minute.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return `每 ${minute.slice(2)} 分钟`;
  }

  // Every hour (at minute M)
  if (/^\d+$/.test(minute) && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return `每小时（第 ${minute} 分钟）`;
  }

  // Daily at HH:MM
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*") {
    return `每天 ${pad(hour)}:${pad(minute)}`;
  }

  // Weekly on specific day(s) at HH:MM
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow !== "*") {
    const days = dow.split(",").map((d) => WEEKDAY_MAP[d] || d).join("、");
    return `每${days} ${pad(hour)}:${pad(minute)}`;
  }

  // Monthly on day D at HH:MM
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === "*" && dow === "*") {
    return `每月 ${dom} 号 ${pad(hour)}:${pad(minute)}`;
  }

  // Yearly
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && /^\d+$/.test(month)) {
    return `每年 ${month} 月 ${dom} 号 ${pad(hour)}:${pad(minute)}`;
  }

  return expr;
}

function pad(n: string): string {
  return n.length < 2 ? `0${n}` : n;
}

/**
 * Basic cron expression validation.
 * Returns true if the expression has 5 space-separated fields.
 */
export function validateCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  // Each field should contain only digits, *, /, -, commas
  return parts.every((p) => /^[\d*\-/,]+$/.test(p));
}

/** Format a timestamp to a relative time string in Chinese. */
export function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return formatFuture(Math.abs(diff));
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function formatFuture(ms: number): string {
  if (ms < 60_000) return "即将";
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)} 分钟后`;
  if (ms < 86_400_000) return `${Math.ceil(ms / 3_600_000)} 小时后`;
  return `${Math.ceil(ms / 86_400_000)} 天后`;
}

/** Format a timestamp to a short date-time string. */
export function formatDateTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${min}`;
}
