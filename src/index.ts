#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sliceTools } from "./tools/slice.js";
import { statusTools } from "./tools/status.js";
import { printTools } from "./tools/print.js";

const server = new McpServer({
  name: "bambu-mcp",
  version: "0.1.0",
});

const allTools = [...sliceTools, ...statusTools, ...printTools];

for (const tool of allTools) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema.shape as any,
    async (args: any) => {
      try {
        const result = await tool.handler(args as any);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Bambu MCP server running");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
