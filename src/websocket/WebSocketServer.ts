
// src/websocket/WebSocketServer.ts
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { inject, singleton } from "tsyringe";
import WebSocket from "ws";
import { VoiceService } from "../business/services/VoiceService";
import { parse } from "url";

@singleton()
export class WebSocketServer {
    private wss!: WebSocket.Server;

    constructor(
        @inject(VoiceService) private voiceService: VoiceService,
    ) {}

    /**
     * Start de WebSocket-server in 'noServer' mode.
     */
    start() {
        this.wss = new WebSocket.Server({ noServer: true });
        console.log("✅ WebSocket server initialized in noServer mode");
    }

    /**
     * Handel een 'upgrade' request van de HTTP-server af.
     */
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
        console.log("🔍 Upgrade request.url:", request.url);
        console.log("Headers:", JSON.stringify(request.headers, null, 2));
        console.log("Raw head buffer length:", head.length);
        const { pathname, query } = parse(request.url!, true);

        if (pathname === "/ws") {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit("connection", ws, request);
                this.handleConnection(ws);
            });
        } else {
            // Belangrijk: vernietig de socket als het pad niet overeenkomt.
            socket.destroy();
        }
    }

    /**
     * Handel een nieuwe WebSocket-verbinding van Twilio af.
     */
    private handleConnection(ws: WebSocket, toFromQuery?: string) {
        console.log("🔌 New WebSocket connection");

        // we will require `to` before starting the stream
        let resolvedTo: string | undefined;

        const handleStartEvent = async (rawMessage: WebSocket.RawData) => {
            const messageString =
              typeof rawMessage === "string" ? rawMessage
                : Buffer.isBuffer(rawMessage) ? rawMessage.toString("utf8")
                  : Array.isArray(rawMessage) ? Buffer.concat(rawMessage).toString("utf8")
                    : rawMessage instanceof ArrayBuffer ? Buffer.from(rawMessage).toString("utf8")
                      : String(rawMessage);

            if (!messageString) return;

            let data: any;
            try {
                data = JSON.parse(messageString);
            } catch (err) {
                console.error("❌ Failed to parse message:", err);
                return;
            }

            if (data.event !== "start") return;

            ws.removeListener("message", handleStartEvent);

            const cp = data.start?.customParameters ?? {};
            const callSid: string = data.start?.callSid;
            const streamSid: string = data.start?.streamSid;

            // ✅ Resolve `to` strictly (Twilio sends it in start.customParameters)
            resolvedTo =
              (typeof cp.to === "string" && cp.to.trim()) ||
              (typeof data.start?.to === "string" && data.start.to.trim()) ||
              (typeof toFromQuery === "string" && toFromQuery.trim()) ||
              undefined;

            if (!resolvedTo) {
                // Hard fail: policy violation (1008) so Twilio sees a clear rejection
                const reason = "Missing required 'to' parameter";
                console.error(`❌ ${reason} (callSid=${callSid || "?"})`);
                try { ws.close(1008, reason); } catch {}
                return;
            }

            console.log(`[${callSid}] start received — to=${resolvedTo}, streamSid=${streamSid}`);

            // Now start, with a guaranteed non-empty `to`
            await this.voiceService.startStreaming(ws, callSid, streamSid, resolvedTo, data);

            // From here you can attach your normal handlers for 'media', etc.
            ws.on("message", (buf) => {
                // handle subsequent media/stop events...
            });
        };

        ws.on("message", handleStartEvent);

        ws.on("close", () => {
            console.log("🔌 Connection closed");
            this.voiceService.stopStreaming();
        });

        ws.on("error", (err) => {
            console.error("❌ WebSocket error:", err);
            this.voiceService.stopStreaming();
        });
    }
}
