import "reflect-metadata";
import type { Express } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "fs";
import path from "path";
import { registerLeadTools } from "./leadsTools";

const MCP_ROUTE = "/mcp/leads";
let serverInstance: McpServer | null = null;

/**
 * Starts the MCP server on the existing Express instance.
 *
 * How to run locally:
 *   1. Start the API as usual (`npm run dev` for watch mode or `npm run start` for prod build).
 *   2. The MCP tools are exposed over HTTP at http://localhost:3003/mcp/leads by default.
 *   3. In OpenAI Agent Builder's "Connect to MCP server" dialog, choose HTTP and point it to that URL.
 */
export function mountLeadsMcpServer(app: Express): void {
    if (serverInstance) {
        return;
    }

    serverInstance = new McpServer({
        name: "callingbird-leads",
        version: resolveAppVersion(),
    });
    registerLeadTools(serverInstance);

    app.post(MCP_ROUTE, async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        res.on("close", () => {
            transport.close().catch((error) => {
                console.error("Failed to close MCP transport", error);
            });
        });

        try {
            await serverInstance?.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error("MCP request handling failed", error);
            if (!res.headersSent) {
                res.status(500).json({ error: "MCP server error" });
            }
        }
    });
}

function resolveAppVersion(): string {
    try {
        const pkg = JSON.parse(
            readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
        );
        return typeof pkg.version === "string" ? pkg.version : "1.0.0";
    } catch (error) {
        console.warn("Unable to read package version for MCP server.", error);
        return "1.0.0";
    }
}
