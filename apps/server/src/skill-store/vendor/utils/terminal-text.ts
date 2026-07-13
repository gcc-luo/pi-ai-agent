const ANSI_OSC_SEQUENCE_PATTERN = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/gu;
const ANSI_ESCAPE_SEQUENCE_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/gu;
const UNSAFE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;

/**
 * Removes terminal control sequences while preserving markdown-friendly whitespace.
 */
export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ANSI_OSC_SEQUENCE_PATTERN, "")
    .replace(ANSI_ESCAPE_SEQUENCE_PATTERN, "")
    .replace(UNSAFE_CONTROL_CHARACTER_PATTERN, "");
}
