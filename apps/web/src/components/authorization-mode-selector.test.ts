import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages.js";

const componentPath = resolve(process.cwd(), "src/components/ChatPanel.vue");

describe("authorization mode composer control", () => {
  it("offers the three session modes from the lower-left composer control", async () => {
    const source = await readFile(componentPath, "utf8");

    expect(source).toContain("authorization-mode-trigger");
    expect(source).toContain("authorization-mode-menu");
    expect(source).toContain("role=\"menuitemradio\"");
    expect(source).toContain("setAuthorizationMode");
    expect(source).toContain("approve_each");
    expect(source).toContain("risk_based");
    expect(source).toContain("full_access");
    expect(source).toContain(".authorization-mode-control {");
    expect(source).toContain("position: relative;");
  });

  it("hides the selected control frame until hover or keyboard focus", async () => {
    const source = await readFile(componentPath, "utf8");
    const baseRule = source.match(/\.authorization-mode-trigger \{([^}]+)\}/)?.[1] ?? "";
    const fullAccessRule = source.match(/\.authorization-mode-trigger\.full-access \{([^}]+)\}/)?.[1] ?? "";

    expect(baseRule).toContain("border: 1px solid transparent;");
    expect(baseRule).toContain("background: transparent;");
    expect(fullAccessRule).toContain("border-color: transparent;");
    expect(fullAccessRule).toContain("background: transparent;");
    expect(source).toContain(".authorization-mode-trigger:hover:not(:disabled)");
    expect(source).toContain(".authorization-mode-trigger:focus-visible");
    expect(source).toContain(".authorization-mode-trigger.full-access:hover:not(:disabled)");
  });

  it("uses shared tool-operation wording in both locales", () => {
    expect(messages.en["plugins.permissionTitle"]).toBe("Confirm tool action");
    expect(messages.zh["plugins.permissionTitle"]).toBe("确认工具操作");
    expect(messages.en["plugins.permissionAction"]).toContain("{tool}");
    expect(messages.zh["plugins.permissionAction"]).toContain("{tool}");
    expect(messages.zh["chat.authorizationMode.full_access"]).toContain("完全访问");
  });

  it("keeps permission details bounded when rendering a pending request", async () => {
    const source = await readFile(componentPath, "utf8");
    const messageStart = source.indexOf("const permissionMessage = computed(");
    const messageEnd = source.indexOf("function respondToPermission", messageStart);
    const messageSource = source.slice(messageStart, messageEnd);
    const helperStart = source.indexOf("function boundedPermissionText");
    const helperEnd = source.indexOf("const pendingTipLabel", helperStart);
    const helperSource = source.slice(helperStart, helperEnd);

    expect(helperSource).toContain("value.slice(0, maxLength)");
    expect(messageSource).toContain("boundedPermissionText(action, 240)");
    expect(messageSource).toContain("pending.toolName");
    expect(messageSource).toContain("pending.reason");
    expect(messageSource).not.toContain("JSON.stringify(pending");
  });
});
