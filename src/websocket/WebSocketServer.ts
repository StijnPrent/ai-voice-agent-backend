
// src/websocket/WebSocketServer.ts
import { Server } from "http";
import { inject, singleton } from "tsyringe";
import WebSocket from "ws";
import { VoiceService } from "../business/services/VoiceService";

@singleton()
export class WebSocketServer {
    private wss!: WebSocket.Server;

    constructor(
        @inject(VoiceService) private voiceService: VoiceService,
    ) {}

    /**
     * Start de WebSocket-server.
     */
    start(server: Server) {
        this.wss = new WebSocket.Server({ server, path: "/ws" });
        this.wss.on("connection", this.handleConnection.bind(this));
        console.log("✅ WebSocket server started on /ws");
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
                    await this.voiceService.startStreaming(ws, data.start.callSid);
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
