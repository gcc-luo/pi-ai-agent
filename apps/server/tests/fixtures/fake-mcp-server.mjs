import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "pi-web-ui-test", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: "read_data", description: "Read test data", inputSchema: { type: "object", properties: { value: { type: "string" } } } },
  { name: "write_data", description: "Write test data", inputSchema: { type: "object", properties: { value: { type: "string" } } } },
] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: JSON.stringify({ tool: request.params.name, arguments: request.params.arguments, tokenConfigured: Boolean(process.env.TEST_API_TOKEN) }) }],
}));
await server.connect(new StdioServerTransport());
