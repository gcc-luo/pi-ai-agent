import type { SessionAuthorizationMode } from "@pi-web-ui/shared";

export interface AuthorizationInput {
  sessionId: string;
  source?: "core_tool" | "plugin" | "connector";
  pluginId?: string;
  toolName: string;
  action: string;
  risk: "normal" | "sensitive" | "destructive";
  policy?: "allow" | "ask" | "deny";
  reason?: string;
  intent?: string;
  context?: { target?: string; files?: string[]; url?: string; windowId?: string };
  signal?: AbortSignal;
}

interface AuthorizationDependencies {
  getMode: (sessionId: string) => Promise<SessionAuthorizationMode | null>;
  request: (input: AuthorizationInput) => Promise<boolean>;
}

export interface AuthorizationDecision {
  approved: boolean;
  prompted: boolean;
}

export class AuthorizationService {
  constructor(private readonly dependencies: AuthorizationDependencies) {}

  async authorize(input: AuthorizationInput): Promise<boolean> {
    return (await this.authorizeWithDecision(input)).approved;
  }

  async authorizeWithDecision(input: AuthorizationInput): Promise<AuthorizationDecision> {
    if (input.policy === "deny") return { approved: false, prompted: false };

    let mode: SessionAuthorizationMode | null = null;
    try {
      mode = await this.dependencies.getMode(input.sessionId);
    } catch {
      // A missing policy store must never suppress a confirmation required below.
    }

    if (mode === "full_access") return { approved: true, prompted: false };

    const needsApproval = mode === "approve_each"
      || input.policy === "ask"
      || input.risk !== "normal";

    if (!needsApproval) return { approved: true, prompted: false };

    if (mode === "risk_based" && input.policy === "allow") return { approved: true, prompted: false };

    try {
      return { approved: await this.dependencies.request(input), prompted: true };
    } catch {
      return { approved: false, prompted: true };
    }
  }
}
