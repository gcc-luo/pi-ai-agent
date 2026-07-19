// Skill-specific hints that get auto-injected into the user's message when the
// corresponding skill is selected. Each entry is wrapped in sentinel markers
// before being sent to Pi so the chat UI can strip it back out of the visible
// bubble and surface it as a distinct "附加提示" badge instead.
//
// Why injection (not just relying on the skill's SKILL.md): Pi can trim or skip
// later sections of a skill body when context gets tight. Putting the rule
// directly in the user's prompt — right next to the request — makes the
// "must register a CJK font" requirement impossible to miss on this turn.

export interface SkillTip {
  // i18n key for the short label shown in chips/badges (e.g. "skillTip.pdf.label").
  label: string;
  // The full body prepended to the user's message, wrapped in sentinel markers
  // by the caller.
  body: string;
}

export const SKILL_TIPS: Record<string, SkillTip> = {
  pdf: {
    label: "skillTip.pdf.label",
    body: `【生成 PDF 字体规范 — 必读】
含中文的 PDF 必须显式注册 CJK 字体，否则中文会出现方框、问号或乱码。ReportLab 内置的 Helvetica / Times 只能编码拉丁字符，绝不能用于绘制中文。

最小可用示例（自包含，无需额外脚本）：

\`\`\`python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# 任选系统中可用的中文字体路径，第一个加载成功即停
for path in [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "msyh.ttc",
    "NotoSansSC-Regular.ttf",
]:
    try:
        pdfmetrics.registerFont(TTFont("CJK", path))
        break
    except Exception:
        continue

c = canvas.Canvas("out.pdf")
c.setFont("CJK", 14)        # ← 必须用注册名 "CJK"，不能用 Helvetica
c.drawString(72, 720, "中文内容")
c.save()
\`\`\`

强制要求：
1. canvas.drawString / ParagraphStyle.fontName 必须使用已注册的 CJK 字体名（如 "CJK"），不能用 "Helvetica" / "Times"。
2. 源码文件保存为 UTF-8 编码，避免非字体原因的乱码。
3. 如需加粗，再注册一个 Bold CJK 字体（如 msyhbd.ttc 或 NotoSansSC-Bold.ttf）。
4. 不要在 PDF 中使用 Unicode 上下标字符（₀₁₂₃⁰¹²³ 等），内置字体通常不含这些字形。

完整说明见 pdf 技能 SKILL.md 的"中文字体"小节。`,
  },
};

// Sentinel markers wrapping the tip body inside the message payload. Used by
// ChatPanel.send() to inject and by splitSkillsFromText() to strip back out.
// HTML comments survive the WebSocket round-trip and are stripped from the
// persisted content by the user-bubble renderer before markdown rendering.
export const TIP_START = "<!-- skill-tip:start -->";
export const TIP_END = "<!-- skill-tip:end -->";

export function wrapTipBody(body: string): string {
  return `${TIP_START}\n${body}\n${TIP_END}\n\n`;
}

// Pattern that matches the entire wrapped tip block (including trailing
// newlines) so stripping it leaves the user's original text intact.
export const TIP_BLOCK_RE = /<!-- skill-tip:start -->[\s\S]*?<!-- skill-tip:end -->\n*/g;

export function activeTipBody(skills: string[]): string | null {
  for (const name of skills) {
    const tip = SKILL_TIPS[name];
    if (tip) return wrapTipBody(tip.body);
  }
  return null;
}

export function activeTipLabel(skills: string[]): string | null {
  for (const name of skills) {
    const tip = SKILL_TIPS[name];
    if (tip) return tip.label;
  }
  return null;
}
