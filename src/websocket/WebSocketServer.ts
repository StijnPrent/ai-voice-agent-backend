
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
     * Koppel aan een bestaande HTTP-server.
     */
    start(server: Server) {
        this.wss = new WebSocket.Server({ server, path: "/ws" });
        this.wss.on("connection", this.handleConnection.bind(this));
        console.log("✅ WebSocket-server gestart op /ws");
    }

    /**
     * Nieuwe WebSocket-verbinding van Twilio.
     */
    private handleConnection(ws: WebSocket) {
        console.log("🔌 Nieuwe WebSocket-verbinding");

        // State voor deze verbinding
        let callSid: string | null = null;

        ws.on("message", async (message: string) => {
            const data = JSON.parse(message);

            switch (data.event) {
                // 1) Eerste bericht: 'start' met metadata
                case "start":
                    callSid = data.start.callSid;
                    console.log(`📞 Call gestart: ${callSid}`);
                    // Hier starten we de streaming-pipeline
                    await this.voiceService.startStreaming(ws, callSid!);
                    break;

                // 2) Audio-data van Twilio
                case "media":
                    // Base64-encoded audio payload
                    const audioChunk = data.media.payload;
                    // Stuur door naar de VoiceService
                    this.voiceService.sendAudio(audioChunk);
                    break;

                // 3) Einde van de stream
                case "stop":
                    console.log(`🏁 Call beëindigd: ${callSid}`);
                    this.voiceService.stopStreaming();
                    break;
            }
        });

        ws.on("close", () => {
            console.log("🔌 Verbinding gesloten");
            this.voiceService.stopStreaming();
        });

        ws.on("error", (err) => {
            console.error("❌ WebSocket-fout:", err);
            this.voiceService.stopStreaming();
        });
    }
}
