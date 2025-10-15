// src/websocket/WebSocketServer.ts
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { inject, singleton } from "tsyringe";
import WebSocket from "ws";
import { VoiceService } from "../business/services/VoiceService";
import { VoiceSessionManager } from "../business/services/VoiceSessionManager";
import { parse } from "url";

@singleton()
export class WebSocketServer {
    private wss!: WebSocket.Server;

    constructor(@inject(VoiceSessionManager) private sessionManager: VoiceSessionManager) {}

    /**
     * Start the WebSocket server in 'noServer' mode.
     */
    start() {
        this.wss = new WebSocket.Server({ noServer: true });
        console.log("✅ WebSocket server initialized in noServer mode");
    }

    /**
     * Handle an HTTP 'upgrade' request.
     */
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
        const { pathname } = parse(request.url || "", true);
        console.log("🔍 Upgrade", {
            url: request.url,
            pathname,
            headLen: head.length,
        });

        if (pathname === "/ws") {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                // Emit standard 'connection' for anyone listening
                this.wss.emit("connection", ws, request);
                this.handleConnection(ws);
            });
        } else {
            // Important: destroy if the path doesn't match
            try {
                socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            } catch {}
            socket.destroy();
        }
    }

    /**
     * Handle a new WebSocket connection from Twilio.
     */
    private handleConnection(ws: WebSocket) {
        console.log("🔌 New WebSocket connection");

        // We'll validate after we receive the Twilio "start" frame
        let started = false;
        let activeVoiceService: VoiceService | null = null;

        const handleStartEvent = async (rawMessage: WebSocket.RawData) => {
            const messageString =
              typeof rawMessage === "string"
                ? rawMessage
                : Buffer.isBuffer(rawMessage)
                  ? rawMessage.toString("utf8")
                  : Array.isArray(rawMessage)
                    ? Buffer.concat(rawMessage).toString("utf8")
                    : rawMessage instanceof ArrayBuffer
                      ? Buffer.from(rawMessage).toString("utf8")
                      : String(rawMessage);

            if (!messageString) return;

            let data: any;
            try {
                data = JSON.parse(messageString);
            } catch (err) {
                console.error("❌ Failed to parse message JSON:", err);
                return;
            }

            // Only act on the first 'start'
            if (data.event !== "start" || started) return;
            started = true;

            // From now on, other messages shouldn't trigger start logic
            ws.removeListener("message", handleStartEvent);

            const start = data.start ?? {};
            const cp = start.customParameters ?? {};
            const callSid: string = start.callSid;
            const streamSid: string = start.streamSid;

            // Prefer customParameters; fall back to any start-level fields if present
            const toParam =
              (typeof cp.to === "string" && cp.to.trim()) ||
              (typeof start.to === "string" && start.to.trim()) ||
              "";

            const fromParam =
              (typeof cp.from === "string" && cp.from.trim()) ||
              (typeof start.from === "string" && start.from.trim()) ||
              "";

            // Debug logs (safe)
            console.log(
              `[${callSid ?? "?"}] ▶ START frame`,
              JSON.stringify(
                {
                    streamSid,
                    hasCustomParameters: !!start.customParameters,
                    toPresent: Boolean(toParam),
                    fromPresent: Boolean(fromParam),
                },
                null,
                2
              )
            );

            if (!callSid) {
                const reason = "Missing required 'callSid' parameter in Twilio start event";
                console.error(`❌ ${reason}.`);
                try {
                    ws.close(1008, reason);
                } catch {}
                return;
            }

            if (!toParam) {
                const reason = "Missing required 'to' parameter (expected in start.customParameters)";
                console.error(`❌ ${reason}; callSid=${callSid ?? "?"}`);
                try {
                    ws.close(1008, reason); // Policy violation so Twilio gets a clear failure
                } catch {}
                return;
            }

            // Start streaming to your voice service
            try {
                const voiceService = this.sessionManager.createSession(callSid);
                activeVoiceService = voiceService;

                await voiceService.startStreaming(
                  ws,
                  callSid,
                  streamSid,
                  toParam,
                  fromParam || undefined,
                  data // pass the full start payload if you need it
                );
            } catch (err) {
                console.error("❌ startStreaming failed:", err);
                this.sessionManager.releaseSession(callSid, activeVoiceService ?? undefined);
                activeVoiceService = null;
                try {
                    ws.close(1011, "Internal error during startStreaming");
                } catch {}
                return;
            }

            // After start, handle subsequent frames (media, mark, stop) here if needed
            ws.on("message", (buf) => {
                // You can route media/stop/etc. to VoiceService if you wish
                // For now we keep it minimal; your VoiceService may already be listening on ws.
            });
        };

        ws.on("message", handleStartEvent);

        ws.on("close", (code, reason) => {
            console.log(`🔌 Connection closed (${code}) ${reason?.toString?.() || ""}`.trim());
            activeVoiceService?.stopStreaming("websocket closed");
        });

        ws.on("error", (err) => {
            console.error("❌ WebSocket error:", err);
            activeVoiceService?.stopStreaming("websocket error");
            try {
                ws.close(1011, "WebSocket error");
            } catch {}
        });
    }
}