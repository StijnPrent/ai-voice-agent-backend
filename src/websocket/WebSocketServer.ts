
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
        const { pathname, query } = parse(request.url!, true);
        const to = '+18565020784'

        if (pathname === "/ws") {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit("connection", ws, request);
                this.handleConnection(ws, to);
            });
        } else {
            // Belangrijk: vernietig de socket als het pad niet overeenkomt.
            socket.destroy();
        }
    }

    /**
     * Handel een nieuwe WebSocket-verbinding van Twilio af.
     */
    private handleConnection(ws: WebSocket, to: string) {
        console.log(`🔌 New WebSocket connection for ${to}`);

        const handleStartEvent = async (rawMessage: WebSocket.RawData) => {
            let messageString: string;

            if (typeof rawMessage === "string") {
                messageString = rawMessage;
            } else if (Buffer.isBuffer(rawMessage)) {
                messageString = rawMessage.toString("utf8");
            } else if (Array.isArray(rawMessage)) {
                messageString = Buffer.concat(rawMessage).toString("utf8");
            } else if (rawMessage instanceof ArrayBuffer) {
                messageString = Buffer.from(rawMessage).toString("utf8");
            } else {
                messageString = String(rawMessage);
            }

            if (!messageString) {
                return;
            }

            let data: any;
            try {
                data = JSON.parse(messageString);
            } catch (error) {
                console.error("❌ Failed to parse Twilio start event", error);
                return;
            }

            if (data.event === "start") {
                ws.removeListener("message", handleStartEvent);
                console.log(`[${data.start.callSid}] Received start event`);
                await this.voiceService.startStreaming(ws, data.start.callSid, data.start.streamSid, to, data);
            }
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
