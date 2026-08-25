import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../../src/db/migrations.js";
import { ConnectorRepository, defaultPolicy, defaultRisk } from "../../src/connectors/connector-repository.js";
import { CredentialVault } from "../../src/connectors/credential-vault.js";
import { McpRuntimeManager } from "../../src/connectors/mcp-runtime.js";
import { mapMcpCallError } from "../../src/connectors/mcp-runtime.js";
import { ConnectorService } from "../../src/connectors/connector-service.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

const logger = { debug() {}, warn() {} } as any;

describe("connector system", () => {
  let db: Database.Database;
  let directory: string;
  let runtime: McpRuntimeManager;
  let service: ConnectorService;
  let repository: ConnectorRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-connectors-test-"));
    const vault = new CredentialVault(directory);
    repository = new ConnectorRepository(db);
    runtime = new McpRuntimeManager(vault, logger);
    service = new ConnectorService(repository, vault, runtime);
  });

  afterEach(async () => {
    await runtime.shutdown();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function create(scopeId = "workspace-a") {
    const fixture = fileURLToPath(new URL("../fixtures/fake-mcp-server.mjs", import.meta.url));
    return service.create({
      name: "Test MCP", scopeType: "workspace", scopeId,
      config: {
        transport: "stdio", command: process.execPath, args: [fixture],
        env: { TEST_API_TOKEN: { source: "credential", credentialId: "placeholder" } },
      },
      credentials: { "env.TEST_API_TOKEN": "super-secret-value" },
    });
  }

  it("keeps secrets out of sqlite and encrypts the host vault", () => {
    create();
    expect(JSON.stringify(db.prepare("SELECT * FROM connector_instances").all())).not.toContain("super-secret-value");
    expect(fs.readFileSync(path.join(directory, "connector-vault.json"), "utf8")).not.toContain("super-secret-value");
  });

  it("resolves workspace scope and safe default policies", async () => {
    const connector = create();
    const test = await service.test(connector.id);
    expect(test.ok).toBe(true);
    expect(test.toolCount).toBe(2);
    expect(service.searchTools("read", "workspace-a")).toHaveLength(1);
    expect(service.searchTools("read", "workspace-b")).toHaveLength(0);
    expect(defaultRisk("read_data")).toBe("low");
    expect(defaultPolicy(defaultRisk("write_data"))).toBe("ask");
    expect(defaultRisk("doc.insert_attachment")).toBe("medium");
    expect(defaultRisk("mystery_action")).toBe("unknown");
    expect(defaultPolicy(defaultRisk("mystery_action"))).toBe("ask");
  });

  it("refreshes inferred risk when a discovered tool is seen again", () => {
    const connector = create();
    repository.upsertTools(connector.id, [{ name: "doc.insert_attachment" }]);
    db.prepare("UPDATE connector_tools SET risk_level = 'unknown' WHERE connector_id = ? AND tool_name = ?").run(connector.id, "doc.insert_attachment");

    repository.upsertTools(connector.id, [{ name: "doc.insert_attachment" }]);

    expect(repository.findTool(connector.id, "doc.insert_attachment")?.riskLevel).toBe("medium");
  });

  it("matches connector tools using natural-language query terms", async () => {
    const connector = create();
    await service.test(connector.id);
    expect(service.searchTools("Test MCP read data please", "workspace-a").map((tool) => tool.name)).toContain("read_data");
  });

  it("finds the correct Tencent Docs workflow from Chinese natural language", () => {
    const connector = service.connectBuiltin("tencent-docs", "docs-secret-token");
    repository.upsertTools(connector.id, [
      { name: "manage.search_file", description: "根据关键字搜索腾讯文档列表" },
      { name: "sheet.add_sheet", description: "在在线表格中添加一个新的子表（SHEET）" },
      { name: "smartsheet.add_table", description: "在智能表格文档中新增工作表" },
    ]);

    const sheetResults = service.searchTools("腾讯文档 sheet 添加工作表", "workspace-a");
    expect(sheetResults[0]).toMatchObject({ name: "sheet.add_sheet" });
    expect(sheetResults[0]).toHaveProperty("usageGuidance");

    const titleOnlyResults = service.searchTools("腾讯云文档 在线文档 添加记录 写入", "workspace-a");
    expect(titleOnlyResults.map((tool) => tool.name)).toContain("manage.search_file");
  });

  it("preserves MCP business errors instead of reporting a connection failure", () => {
    const error = mapMcpCallError(new McpError(
      -32603,
      "tool execution failed: type:business, code:400001, msg:Resource Not Exist, trace_id:test",
    ));
    expect(error).toMatchObject({
      code: "TOOL_CALL_FAILED",
      message: "外部服务调用失败：Resource Not Exist（错误码 400001）",
    });
  });

  it("enforces deny and ask before invoking MCP", async () => {
    const connector = create();
    await service.test(connector.id);
    service.setTool(connector.id, "write_data", { policy: "deny" });
    const context = { sessionId: "s1", workspaceId: "workspace-a", source: "desktop" as const, cwd: directory };
    await expect(service.invoke(`${connector.id}.write_data`, {}, context, async () => true)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    service.setTool(connector.id, "write_data", { policy: "ask" });
    await expect(service.invoke(`${connector.id}.write_data`, {}, context, async () => false)).rejects.toMatchObject({ code: "USER_REJECTED" });
    const result = await service.invoke(`${connector.id}.write_data`, { value: "ok" }, context, async () => true);
    expect(JSON.stringify(result)).toContain("tokenConfigured");
    expect(service.listAudits(connector.id)).toHaveLength(3);
  });

  it("does not start stdio processes until first discovery or call", () => {
    const connector = create();
    expect(connector.status).toBe("disconnected");
    expect(service.listTools(connector.id)).toEqual([]);
  });

  it("provides Tencent Docs and Tencent Meeting as secure built-in connectors", () => {
    expect(service.catalog().map((item) => item.key)).toEqual(["tencent-docs", "tencent-meeting"]);

    const docs = service.connectBuiltin("tencent-docs", "docs-secret-token");
    expect(docs).toMatchObject({ builtinKey: "tencent-docs", name: "腾讯文档", scopeType: "user" });
    expect(docs.config).toMatchObject({
      transport: "streamable_http",
      url: "https://docs.qq.com/openapi/mcp",
      headers: { Authorization: { source: "credential" } },
    });

    const meeting = service.connectBuiltin("tencent-meeting", "meeting-secret-token");
    expect(meeting).toMatchObject({ builtinKey: "tencent-meeting", name: "腾讯会议" });
    expect(meeting.config).toMatchObject({
      url: "https://mcp.meeting.tencent.com/mcp/wemeet-open/v1",
      headers: {
        "X-Tencent-Meeting-Token": { source: "credential" },
        "X-Skill-Version": { source: "literal", value: "v1.0.14" },
      },
    });
    expect(JSON.stringify(db.prepare("SELECT * FROM connector_instances").all())).not.toContain("secret-token");
    expect(service.catalog().every((item) => item.connected)).toBe(true);
    expect(() => service.connectBuiltin("tencent-docs", "another-token")).toThrow("已经连接");
  });
});
