
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
        const { pathname } = parse(request.url!);

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
    private handleConnection(ws: WebSocket) {
        console.log("🔌 New WebSocket connection");

        ws.on("message", async (message: string) => {
            const data = JSON.parse(message);

            switch (data.event) {
                case "start":
                    console.log(`[${data.start.callSid}] Received start event`);
                    await this.voiceService.startStreaming(ws, data.start.callSid, data.start.streamSid);
                    break;

                case "media":
                    this.voiceService.sendAudio(data.media.payload);
                    break;

                case "mark":
                    this.voiceService.handleMark(data.mark.name);
                    break;

                case "stop":
                    console.log(`[${data.stop.callSid}] Received stop event`);
                    this.voiceService.stopStreaming();
                    break;
            }
        });

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
