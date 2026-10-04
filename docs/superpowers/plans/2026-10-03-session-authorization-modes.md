# Session Authorization Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-session authorization modes for all Pi core tools and the app's plugin, connector, browser, and computer capabilities, with a selector at the left side of the chat composer.

**Architecture:** Persist `approve_each`, `risk_based`, or `full_access` on each session and expose it through the existing session DTO and update API. A shared server authorization service applies the mode while preserving disabled-capability and explicit-deny checks; a Pi `tool_call` extension guards Bash and file tools, while existing host routes guard integrations. The Vue composer updates the mode through the session store and reflects server-sent updates.

**Tech Stack:** TypeScript, Fastify, SQLite migrations via better-sqlite3, Pi extensions, WebSocket events, Vue 3, Pinia, Vitest.

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/shared/src/types.ts` | Shared authorization-mode union and session DTO field. |
| `apps/server/src/db/migrations.ts` | Add a defaulted `authorization_mode` session column. |
| `apps/server/src/db/repositories/session.ts` | Map and update the persisted session mode. |
| `apps/server/src/routes/sessions.ts` | Validate and persist mode changes via the existing session PUT route. |
| `apps/server/src/authorization/authorization-service.ts` | Apply mode precedence, risk and explicit tool-policy decisions. |
| `apps/server/src/authorization/core-tool-risk.ts` | Classify core Pi tool inputs for `risk_based` mode. |
| `apps/server/src/plugins/plugin-permission-service.ts` | Deliver generic tool permission requests and resolve one pending request. |
| `packages/shared/src/types.ts` | Make permission events describe core tools and integrations, not only plugins. |
| `apps/server/src/agent/extensions/authorization-gate.ts` | Intercept Pi core Bash/read/write/edit calls before execution. |
| `apps/server/src/agent/process-manager.ts` | Load the authorization extension for every Pi session and provide its authenticated endpoint. |
| `apps/server/src/routes/plugins.ts` | Apply the shared mode to browser and computer permission decisions. |
| `apps/server/src/routes/connectors.ts` and `apps/server/src/connectors/connector-service.ts` | Apply modes to connector search/describe/call while retaining disabled and deny checks. |
| `apps/server/src/wiring.ts`, `apps/server/src/types/fastify.d.ts` | Construct and expose the authorization service. |
| `apps/web/src/api/client.ts` | Add the typed session authorization-mode update call. |
| `apps/web/src/stores/session.ts` | Persist local mode changes and apply updates to all open session DTOs. |
| `apps/web/src/stores/agent.ts` | Store and expose pending generic permission requests and apply `session_updated`. |
| `apps/web/src/components/ChatPanel.vue` | Add the composer-left mode selector and generalize the permission dialog copy. |
| `apps/web/src/i18n/messages.ts` | Add mode labels, descriptions and generic permission wording in both locales. |

## Task 1: Persist a validated mode on each session

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/db/migrations.ts`
- Modify: `apps/server/src/db/repositories/session.ts`
- Modify: `apps/server/src/routes/sessions.ts`
- Test: `apps/server/tests/unit/session-repo.test.ts`
- Test: `apps/server/tests/integration/migrations.test.ts`
- Test: `apps/server/tests/integration/sessions.test.ts`

- [ ] **Step 1: Add failing repository and migration tests**

Test that a new session has `authorizationMode: "risk_based"`, setting it stores each valid enum, and an old database receives the column with every existing row defaulted to `risk_based`.

Add route cases to `sessions.test.ts`: `PUT /api/sessions/:id` accepts one valid `authorizationMode`, returns the updated DTO, returns 400 for any other value, and returns 404 for a missing session. Preserve existing title/expert update cases.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/session-repo.test.ts tests/integration/migrations.test.ts tests/integration/sessions.test.ts`

Expected: failures show the absent DTO property, repository setter, and PUT validation behavior.

- [ ] **Step 3: Add the shared type and migration**

Add the type and DTO field in `packages/shared/src/types.ts`:

```ts
export type SessionAuthorizationMode = "approve_each" | "risk_based" | "full_access";
```

Add `authorizationMode: SessionAuthorizationMode` to `SessionDto`. Append migration `030_session_authorization_mode` in `apps/server/src/db/migrations.ts`:

```sql
ALTER TABLE sessions ADD COLUMN authorization_mode TEXT NOT NULL DEFAULT 'risk_based';
```

- [ ] **Step 4: Map and update the repository mode**

In `apps/server/src/db/repositories/session.ts`, add `authorization_mode` to `Row`, map it to `authorizationMode` in `toDto`, initialize new DTOs to `risk_based`, and add `setAuthorizationMode(id, mode)` following `setExpert`: verify the session exists, update the column and `updated_at`, then return through `findById` at the route layer.

- [ ] **Step 5: Validate the existing session PUT route**

In `apps/server/src/routes/sessions.ts`, extend the body type with `authorizationMode?: SessionAuthorizationMode`; accept only the three enum values, call `setAuthorizationMode`, and include `authorizationMode` in the existing “no supported fields” validation. Keep title and expert validation unchanged.

- [ ] **Step 6: Run the focused server tests**

Run the command from Step 2.

Expected: all three files' tests pass, including old-row default and invalid-value rejection.

- [ ] **Step 7: Commit the session contract**

```bash
git add packages/shared/src/types.ts apps/server/src/db/migrations.ts apps/server/src/db/repositories/session.ts apps/server/src/routes/sessions.ts apps/server/tests/unit/session-repo.test.ts apps/server/tests/integration/migrations.test.ts apps/server/tests/integration/sessions.test.ts
git commit -m "feat(server): 持久化会话授权模式"
```

## Task 2: Implement shared mode and risk decisions

**Files:**
- Create: `apps/server/src/authorization/authorization-service.ts`
- Create: `apps/server/src/authorization/core-tool-risk.ts`
- Test: `apps/server/tests/unit/authorization-service.test.ts`
- Test: `apps/server/tests/unit/core-tool-risk.test.ts`
- Modify: `apps/server/src/wiring.ts`
- Modify: `apps/server/src/types/fastify.d.ts`

- [ ] **Step 1: Write mode-precedence tests**

Cover `approve_each` asking even for normal operations, `risk_based` allowing normal and asking for sensitive/destructive operations, `full_access` skipping the prompt, `deny` always rejecting, explicit `allow` keeping the connector's current risk-based behavior, and a failed permission request returning false. Inject mode lookup and the existing pending-permission requester so the service is deterministic.

- [ ] **Step 2: Write core-tool risk tests**

Cover `read` inside the project as normal and outside as sensitive; `write`/`edit` inside the project as normal and outside as sensitive, including symlinks to outside targets; destructive shell patterns (recursive deletion, formatting, shutdown, privilege escalation, downloaded content piped to a shell, nested `-c` payloads, command substitutions, and backticks) as destructive or sensitive. Keep only an explicit list of simple known-safe commands and exact informational package-runner queries normal; package scripts, interpreters, unknown commands, unparsed syntax and excessive nesting require confirmation. Resolve existing paths and the nearest existing parent of new paths through real paths before comparing against the work directory.

- [ ] **Step 3: Run the focused tests and verify they fail**

Run: `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/authorization-service.test.ts tests/unit/core-tool-risk.test.ts`

Expected: imports fail because the authorization modules do not exist.

- [ ] **Step 4: Implement the policy and classifier**

Export `AuthorizationService.authorize(input)` with this input shape:

```ts
interface AuthorizationInput {
  sessionId: string;
  toolName: string;
  action: string;
  risk: "normal" | "sensitive" | "destructive";
  policy?: "allow" | "ask" | "deny";
  reason?: string;
  context?: { target?: string; files?: string[]; url?: string };
  signal?: AbortSignal;
}
```

Load the session mode on every call. Apply precedence in this order: explicit `deny` rejects; `full_access` allows enabled capabilities; `approve_each` requests one approval; `risk_based` allows explicit connector `allow`, requests approval for explicit `ask` or non-normal risk, and otherwise allows. Missing session/mode or permission UI state must not turn a confirmation-required operation into an allow.

`core-tool-risk.ts` exports `classifyCoreToolRisk({ toolName, input, workdir })`. Use `realpath` for existing targets and the nearest existing ancestor of missing targets, then compare the resolved path against the real work directory. Parse command segments, known wrappers and bounded nested shell `-c` payloads. Treat shell syntax or executable effects the classifier cannot establish as safe as sensitive; do not allow package-manager scripts or interpreters merely because they run from the project directory. Use destructive reasons for recursive deletion, formatting, shutdown, privilege escalation and downloaded-content pipelines; return a stable reason alongside the level.

- [ ] **Step 5: Wire the service**

Construct `AuthorizationService` in `apps/server/src/wiring.ts` with `sessions` and a requester adapter over `PluginPermissionService.request`. Decorate Fastify with `authorization`; add the matching declaration in `apps/server/src/types/fastify.d.ts`.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/authorization-service.test.ts tests/unit/core-tool-risk.test.ts`

Run: `pnpm --filter @pi-web-ui/server typecheck`

Expected: tests pass and the server typecheck exits 0.

- [ ] **Step 7: Commit the authorization policy**

```bash
git add apps/server/src/authorization apps/server/src/wiring.ts apps/server/src/types/fastify.d.ts apps/server/tests/unit/authorization-service.test.ts apps/server/tests/unit/core-tool-risk.test.ts
git commit -m "feat(server): 新增统一授权策略"
```

## Task 3: Generalize permission requests and gate host integrations

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/plugins/plugin-permission-service.ts`
- Modify: `apps/server/src/routes/plugins.ts`
- Modify: `apps/server/src/routes/connectors.ts`
- Modify: `apps/server/src/connectors/connector-service.ts`
- Test: `apps/server/tests/unit/plugin-permission-service.test.ts`
- Test: `apps/server/tests/unit/connectors.test.ts`
- Test: `apps/server/tests/integration/native-browser-routes.test.ts`
- Test: `apps/server/tests/integration/sessions.test.ts`

- [ ] **Step 1: Add failing service and route tests**

Verify permission events can identify a core tool or connector without requiring a plugin ID; mode changes cause browser/computer/connector actions to ask, skip, or deny as defined; connector `deny` and disabled tools remain rejected in `full_access`; and each `toolCallId` produces no more than one pending request when the extension hook and host route cover the same invocation.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/plugin-permission-service.test.ts tests/unit/connectors.test.ts tests/integration/native-browser-routes.test.ts tests/integration/sessions.test.ts`

Expected: failures identify the plugin-only event shape and missing mode handling.

- [ ] **Step 3: Generalize the permission event**

Extend the `permission_request` variant in `packages/shared/src/types.ts` with `source: "core_tool" | "plugin" | "connector"`, optional `pluginId`, and `toolName`; retain `action`, `reason`, `intent`, `context`, and expiry fields. Update `PluginPermissionService.request` to accept those source fields and keep its session-bound response, abort, timeout, and cancel behavior.

- [ ] **Step 4: Route integration decisions through the shared service**

In `apps/server/src/routes/plugins.ts`, preserve `browserCallNeedsConfirmation` and `computerRisk`, then pass their risk and tool identity to `app.authorization.authorize`. Gate the WeChat file-transfer action as a sensitive plugin operation after session token/active-capability checks and before sending files. In connector call flow, check the tool's enabled state and `deny` policy before asking the shared service; pass its stored policy and risk level. Apply `approve_each` to connector search/describe as well as call. Keep current audit records and attach the final approval result.

Call the shared authorization service once at each host execution boundary. Task 4's Pi hook handles only built-in Bash/read/write/edit calls, so host integration tools must not be double-wrapped by that hook. Verify that each individual browser, computer, WeChat or connector call emits at most one permission event.

- [ ] **Step 5: Run focused route and broker tests**

Run the command from Step 2.

Expected: mode matrix passes, a denied/disabled connector never prompts, and a tool invocation yields at most one permission event.

- [ ] **Step 6: Commit shared host authorization**

```bash
git add packages/shared/src/types.ts apps/server/src/plugins/plugin-permission-service.ts apps/server/src/routes/plugins.ts apps/server/src/routes/connectors.ts apps/server/src/connectors/connector-service.ts apps/server/tests/unit/plugin-permission-service.test.ts apps/server/tests/unit/connectors.test.ts apps/server/tests/integration/native-browser-routes.test.ts apps/server/tests/integration/sessions.test.ts
git commit -m "feat(server): 统一插件连接器授权检查"
```

## Task 4: Intercept core Pi tools before execution

**Files:**
- Create: `apps/server/src/agent/extensions/authorization-gate.ts`
- Modify: `apps/server/src/agent/process-manager.ts`
- Modify: `apps/server/src/routes/plugins.ts`
- Modify: `apps/server/src/wiring.ts`
- Test: `apps/server/tests/unit/authorization-gate.test.ts`
- Test: `apps/server/tests/unit/process-manager.test.ts`
- Test: `apps/server/tests/integration/authorization-gate.test.ts`

- [ ] **Step 1: Test the Pi hook before adding it**

Use a fake `ExtensionAPI.on` to invoke the registered `tool_call` handler. Verify `bash`, `read`, `write`, and `edit` send the tool name and inputs to the host authorization endpoint; allowed calls return without blocking; denied calls return `{ block: true, reason }`; unknown tool names pass through; and an aborted request blocks instead of executing.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/authorization-gate.test.ts tests/unit/process-manager.test.ts`

Expected: the authorization extension and required process wiring assertions are absent.

- [ ] **Step 3: Add a Pi `tool_call` authorization extension**

Create `authorization-gate.ts`; register a `tool_call` hook using `isToolCallEventType` for the four core tool names. Send `{ toolCallId, toolName, input }` to a session-scoped internal endpoint with the extension's host token and `ctx.signal`. Return `{ block: true, reason }` on rejection, timeout, or transport error; return no block for approval. Do not forward API keys or environment values.

- [ ] **Step 4: Load and authenticate the extension in every process**

Add an authorization extension path and endpoint to `ProcessManagerOptions`; append `--extension <path>` for every session, independent of selected plugins. Issue a random per-session authorization token, put only its endpoint/token/session ID in the child environment, validate it in the internal Fastify route, and revoke it in `stop`, `stopAndWait`, process exit, session deletion, and shutdown.

The internal route loads the current session mode, project workdir, and core risk result, then calls `AuthorizationService.authorize`. Return only `{ approved, reason? }`; never accept a user-confirmed flag from tool arguments.

- [ ] **Step 5: Add integration coverage for fail-closed execution**

Verify a normal `risk_based` core read is allowed, an out-of-workdir write or destructive Bash operation requests permission, `approve_each` requests permission for every core tool, `full_access` allows the same eligible operation without a permission event, and bad token/timeout/session missing blocks the tool.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm --filter @pi-web-ui/server exec vitest run tests/unit/authorization-gate.test.ts tests/unit/process-manager.test.ts tests/integration/authorization-gate.test.ts`

Run: `pnpm --filter @pi-web-ui/server typecheck`

Expected: all tests pass and the server typecheck exits 0.

- [ ] **Step 7: Commit core tool enforcement**

```bash
git add apps/server/src/agent/extensions/authorization-gate.ts apps/server/src/agent/process-manager.ts apps/server/src/routes/plugins.ts apps/server/src/wiring.ts apps/server/tests/unit/authorization-gate.test.ts apps/server/tests/unit/process-manager.test.ts apps/server/tests/integration/authorization-gate.test.ts
git commit -m "feat(server): 拦截核心工具授权请求"
```

## Task 5: Add the composer selector and generalized confirmation UI

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/stores/session.ts`
- Modify: `apps/web/src/stores/agent.ts`
- Modify: `apps/web/src/components/ChatPanel.vue`
- Modify: `apps/web/src/i18n/messages.ts`
- Test: `apps/web/tests/unit/authorization-mode-selector.test.ts`
- Test: `apps/web/tests/unit/agent-session-updated.test.ts`

- [ ] **Step 1: Add failing mode update and selector tests**

Test that selecting each option calls the session PUT API and immediately updates the displayed mode; a failed API call restores the previous mode and reports the error; a `session_updated` event updates the active session mode; changing sessions never carries a mode from the prior session; and the generic permission dialog displays tool identity, action and reason for core-tool requests.

- [ ] **Step 2: Run focused web tests and verify they fail**

Run: `pnpm --filter @pi-web-ui/web exec vitest run tests/unit/authorization-mode-selector.test.ts tests/unit/agent-session-updated.test.ts`

Expected: the selector is absent and the shared session store ignores the new mode field.

- [ ] **Step 3: Add typed API and store support**

Add `api.updateSessionAuthorizationMode(id, authorizationMode)` using `PUT /sessions/${id}`. In `useSessionStore`, update the current session and list entry from the returned DTO. Keep the server DTO authoritative after request completion; on failure leave the prior DTO unchanged. Continue applying WebSocket `session_updated` through the existing `applySession` action.

- [ ] **Step 4: Add the selector to the composer**

In `ChatPanel.vue`, place a button at the lower-left edge of `.composer-input-wrap`, opposite the model/send controls. Open a keyboard-accessible popover with these rows: `请求批准` / every eligible tool call asks; `帮我批准` / only detected risky operations ask; `完全访问` / skip tool confirmation. Highlight the selected row and visually emphasize `完全访问`. Bind the selection to the current session DTO and disable the selector while a mode update is in flight.

- [ ] **Step 5: Generalize modal text and localize strings**

Update both locale maps in `messages.ts` so the permission dialog title and description say “工具操作” rather than “插件操作”; render source/tool/action/reason without dumping unbounded raw JSON. Preserve existing approve, deny, close, expiry and accessibility behavior.

- [ ] **Step 6: Run web tests and build**

Run the command from Step 2.

Run: `pnpm --filter @pi-web-ui/web build`

Expected: focused tests pass and Vue typecheck/Vite build exits 0.

- [ ] **Step 7: Commit the composer mode control**

```bash
git add apps/web/src/api/client.ts apps/web/src/stores/session.ts apps/web/src/stores/agent.ts apps/web/src/components/ChatPanel.vue apps/web/src/i18n/messages.ts apps/web/tests/unit/authorization-mode-selector.test.ts apps/web/tests/unit/agent-session-updated.test.ts
git commit -m "feat(web): 新增会话授权模式选择器"
```

## Task 6: Verify the complete authorization matrix

**Files:**
- Test: `apps/server/tests/integration/authorization-gate.test.ts`
- Test: `apps/server/tests/integration/native-browser-routes.test.ts`
- Test: `apps/server/tests/integration/sessions.test.ts`
- Test: `apps/web/tests/unit/authorization-mode-selector.test.ts`

- [ ] **Step 1: Complete cross-capability assertions**

Parameterize the server integration tests over all modes and these call categories: core Bash/read/write/edit, browser, computer, plugin action, connector search/describe/call. Assert one decision per call; assert hard-deny and disabled-plugin outcomes in every mode; assert session A's mode never affects session B; assert changing a mode affects the next call while a currently pending request remains unchanged.

- [ ] **Step 2: Run relevant server and web test suites**

Run: `pnpm --filter @pi-web-ui/server test`

Run: `pnpm --filter @pi-web-ui/web test`

Expected: both suites exit 0. Investigate and fix only failures introduced by this feature; preserve unrelated pre-existing worktree changes.

- [ ] **Step 3: Run production typechecks and builds**

Run: `pnpm --filter @pi-web-ui/server build`

Run: `pnpm --filter @pi-web-ui/web build`

Expected: both commands exit 0.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only this feature's intended files are staged for its commits, and pre-existing unrelated changes remain untouched.

## Execution notes

- Keep each commit scoped to the files listed in its task; do not use `git add -A` because the starting worktree has unrelated changes.
- Do not update the design spec unless implementation discovers a behavior contradiction; if one does, stop and request approval for a spec revision before changing behavior.
- The authorization integration must use the persisted session mode on each tool call so changing the menu does not require restarting the Pi process.
- Explicit plugin disabled state, connector `deny`, session token validation, abort handling and timeout denial remain server-side checks in every mode.
