import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/authorization/authorization-service.js";

function createService(options?: {
  mode?: "approve_each" | "risk_based" | "full_access" | null;
  modeError?: Error;
  approved?: boolean;
  requestError?: Error;
}) {
  const request = vi.fn(async () => {
    if (options?.requestError) throw options.requestError;
    return options?.approved ?? true;
  });
  const getMode = vi.fn(async () => {
    if (options?.modeError) throw options.modeError;
    return options?.mode ?? "risk_based";
  });
  return { service: new AuthorizationService({ getMode, request }), getMode, request };
}

describe("AuthorizationService", () => {
  it("asks for approval for normal operations in approve_each mode", async () => {
    const { service, request } = createService({ mode: "approve_each" });
    await expect(service.authorize({ sessionId: "s1", toolName: "read", action: "read file", risk: "normal" })).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps approve_each stronger than an explicit connector allow", async () => {
    const { service, request } = createService({ mode: "approve_each" });
    await expect(service.authorize({ sessionId: "s1", toolName: "connector.call", action: "call", risk: "normal", policy: "allow" })).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it("allows normal operations and asks for sensitive operations in risk_based mode", async () => {
    const { service, request } = createService({ mode: "risk_based" });
    await expect(service.authorize({ sessionId: "s1", toolName: "read", action: "read", risk: "normal" })).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
    await expect(service.authorize({ sessionId: "s1", toolName: "write", action: "write", risk: "sensitive" })).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it("asks for destructive operations in risk_based mode", async () => {
    const { service, request } = createService({ mode: "risk_based" });
    await expect(service.authorize({ sessionId: "s1", toolName: "bash", action: "run", risk: "destructive" })).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it("skips prompts in full_access mode", async () => {
    const { service, request } = createService({ mode: "full_access" });
    await expect(service.authorize({ sessionId: "s1", toolName: "bash", action: "run", risk: "destructive" })).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("loads the latest mode per session while leaving an existing approval pending", async () => {
    const modes = new Map<string, "approve_each" | "risk_based" | "full_access" | null>([
      ["session-a", "approve_each"],
      ["session-b", "full_access"],
    ]);
    const pendingApprovals: Array<(approved: boolean) => void> = [];
    const request = vi.fn(() => new Promise<boolean>((resolve) => pendingApprovals.push(resolve)));
    const getMode = vi.fn(async (sessionId: string) => modes.get(sessionId) ?? null);
    const service = new AuthorizationService({ getMode, request });

    const firstApproval = service.authorize({
      sessionId: "session-a", toolName: "read", action: "read", risk: "normal",
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

    modes.set("session-a", "risk_based");
    await expect(service.authorize({
      sessionId: "session-a", toolName: "read", action: "read", risk: "normal",
    })).resolves.toBe(true);
    await expect(service.authorize({
      sessionId: "session-b", toolName: "read", action: "read", risk: "normal",
    })).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();

    modes.set("session-b", "approve_each");
    const secondApproval = service.authorize({
      sessionId: "session-b", toolName: "read", action: "read", risk: "normal",
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    pendingApprovals[0]?.(true);
    pendingApprovals[1]?.(false);
    await expect(firstApproval).resolves.toBe(true);
    await expect(secondApproval).resolves.toBe(false);
    expect(getMode).toHaveBeenCalledWith("session-a");
    expect(getMode).toHaveBeenCalledWith("session-b");
  });

  it("reports whether the shared boundary requested confirmation", async () => {
    const riskBased = createService({ mode: "risk_based", approved: true });
    await expect(riskBased.service.authorizeWithDecision({
      sessionId: "s1", toolName: "read", action: "read", risk: "normal", policy: "allow",
    })).resolves.toEqual({ approved: true, prompted: false });

    const approveEach = createService({ mode: "approve_each", approved: true });
    await expect(approveEach.service.authorizeWithDecision({
      sessionId: "s1", toolName: "read", action: "read", risk: "normal", policy: "allow",
    })).resolves.toEqual({ approved: true, prompted: true });

    const fullAccess = createService({ mode: "full_access" });
    await expect(fullAccess.service.authorizeWithDecision({
      sessionId: "s1", toolName: "write", action: "write", risk: "sensitive", policy: "ask",
    })).resolves.toEqual({ approved: true, prompted: false });
  });

  it("always rejects an explicit deny policy", async () => {
    const { service, request } = createService({ mode: "full_access" });
    await expect(service.authorize({ sessionId: "s1", toolName: "connector.call", action: "call", risk: "normal", policy: "deny" })).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves explicit connector allow behavior in risk_based mode", async () => {
    const { service, request } = createService({ mode: "risk_based" });
    await expect(service.authorize({ sessionId: "s1", toolName: "connector.call", action: "call", risk: "destructive", policy: "allow" })).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("treats an unanswered or failed approval request as denied", async () => {
    const unanswered = createService({ mode: "risk_based", approved: false });
    await expect(unanswered.service.authorize({ sessionId: "s1", toolName: "write", action: "write", risk: "sensitive" })).resolves.toBe(false);
    const failed = createService({ mode: "risk_based", requestError: new Error("socket closed") });
    await expect(failed.service.authorize({ sessionId: "s1", toolName: "write", action: "write", risk: "sensitive" })).resolves.toBe(false);
  });

  it("still asks when a missing or unreadable mode accompanies a risky operation", async () => {
    for (const options of [{ mode: null }, { modeError: new Error("db unavailable") }]) {
      const { service, request } = createService(options);
      await expect(service.authorize({ sessionId: "s1", toolName: "bash", action: "run", risk: "destructive" })).resolves.toBe(true);
      expect(request).toHaveBeenCalledOnce();
    }
  });
});
