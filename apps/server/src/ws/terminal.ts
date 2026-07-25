import type { FastifyPluginAsync } from "fastify";
import type { ModelConfig } from "../agent/process-manager.js";

type TerminalClientEvent =
  | { type: "attach"; sessionId: string; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

const MAX_INPUT_BYTES = 64 * 1024;

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export const terminalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/ws/terminal", { websocket: true }, (connection) => {
    let detach: (() => void) | undefined;
    let attachedSessionId: string | undefined;

    const send = (event: Record<string, unknown>) => {
      try { connection.send(JSON.stringify(event)); } catch {}
    };

    connection.on("message", async (raw: Buffer) => {
      let event: TerminalClientEvent;
      try { event = JSON.parse(raw.toString()) as TerminalClientEvent; } catch { return; }

      if (event.type === "attach") {
        const session = app.sessions.findById(event.sessionId);
        if (!session) {
          send({ type: "error", code: "no_session", message: "session not found" });
          return;
        }
        const project = app.projects.findById(session.projectId);
        if (!project) {
          send({ type: "error", code: "no_project", message: "project gone" });
          return;
        }

        // An RPC process and an interactive TUI cannot safely drive the same
        // Pi session. Stop the inactive transport before moving into TUI mode.
        const rpcState = app.sessionStates.get(session.id);
        if (rpcState) {
          await app.processManager.stopAndWait(session.id);
          app.sessionStates.delete(session.id);
        }

        const defaultModel = app.models.getDefault();
        const modelConfig: ModelConfig | undefined = defaultModel ? {
          provider: defaultModel.provider,
          model: defaultModel.id,
          modelType: defaultModel.modelType,
          apiKey: app.models.getApiKey(defaultModel.id),
          apiBaseUrl: defaultModel.apiBaseUrl,
        } : undefined;
        let terminal;
        try {
          terminal = app.tuiProcessManager.start({
            sessionId: session.id,
            projectId: project.id,
            workdir: project.workdir,
            cols: positiveNumber(event.cols, 120),
            rows: positiveNumber(event.rows, 36),
            modelConfig,
          });
        } catch (error: any) {
          app.log.error({ err: error, sessionId: session.id }, "failed to spawn Pi TUI process");
          send({ type: "error", code: "tui_start_failed", message: error?.message ?? "failed to start Pi TUI" });
          return;
        }
        detach?.();
        const onData = (data: string) => send({ type: "output", data });
        const onExit = (code: number, signal?: number) => send({ type: "exit", code, signal });
        terminal.on("data", onData);
        terminal.on("exit", onExit);
        detach = () => {
          terminal.off("data", onData);
          terminal.off("exit", onExit);
        };
        attachedSessionId = session.id;
        app.sessions.touch(session.id, "active");
        send({ type: "ready", sessionId: session.id, pid: terminal.pid });
        // xterm's scrollback is local to the browser. Replay the bounded raw
        // terminal stream so a refresh or a session switch restores Pi's
        // current screen before forwarding subsequent live output.
        const history = terminal.history();
        if (history) send({ type: "output", data: history });
        return;
      }

      if (!attachedSessionId) return;
      const terminal = app.tuiProcessManager.get(attachedSessionId);
      if (!terminal) {
        send({ type: "exit", code: 0 });
        return;
      }
      if (event.type === "input" && typeof event.data === "string") {
        if (Buffer.byteLength(event.data) <= MAX_INPUT_BYTES) terminal.write(event.data);
      } else if (event.type === "resize") {
        terminal.resize(positiveNumber(event.cols, 120), positiveNumber(event.rows, 36));
      }
    });

    connection.on("close", () => detach?.());
  });
};
