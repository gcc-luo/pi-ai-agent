import type { SessionAuthorizationMode } from "@pi-web-ui/shared";

export interface AuthorizationInput {
  sessionId: string;
  toolName: string;
  action: string;
  risk: "normal" | "sensitive" | "destructive";
  policy?: "allow" | "ask" | "deny";
  reason?: string;
  context?: { target?: string; files?: string[]; url?: string };
  signal?: AbortSignal;
}

interface AuthorizationDependencies {
  getMode: (sessionId: string) => Promise<SessionAuthorizationMode | null>;
  request: (input: AuthorizationInput) => Promise<boolean>;
}

export class AuthorizationService {
  constructor(private readonly dependencies: AuthorizationDependencies) {}

  async authorize(input: AuthorizationInput): Promise<boolean> {
    if (input.policy === "deny") return false;

    let mode: SessionAuthorizationMode | null = null;
    try {
      mode = await this.dependencies.getMode(input.sessionId);
    } catch {
      // A missing policy store must never suppress a confirmation required below.
    }

    if (mode === "full_access") return true;

    const needsApproval = mode === "approve_each"
      || input.policy === "ask"
      || input.risk !== "normal";

    if (!needsApproval) return true;

    if (mode === "risk_based" && input.policy === "allow") return true;

    try {
      return await this.dependencies.request(input);
    } catch {
      return false;
    }
  }
}
