// src/websocket/WebSocketServer.ts
import { Server as HttpServer, IncomingMessage } from "http";
import { inject, singleton } from "tsyringe";
import WebSocket, { Server as WsServer } from "ws";
import { VoiceService } from "../business/services/VoiceService";

@singleton()
export class WebSocketServer {
    private wss!: WsServer;

    constructor(
        @inject(VoiceService) private voiceService: VoiceService,
    ) {}

    /**
     * Must be called from your main file with your `http.createServer(app)` instance.
     * This ensures ws handles the Upgrade before Express sees the request.
     */
    public start(server: HttpServer) {
        // ==== This is the magic bit: ====
        this.wss = new WsServer({ server, path: "/ws" });

        this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
            console.log("🔌 WS connection established");

            // Twilio will append ?streamSid=XXX or ?CallSid=YYY
            const url = new URL(req.url!, `https://${req.headers.host}`);
            const callSid = url.searchParams.get("streamSid") || url.searchParams.get("CallSid");
            if (!callSid) {
                ws.close(1008, "Missing CallSid");
                return;
            }

            // Kick off your streaming service
            this.voiceService.startStreaming(ws, callSid);

            ws.on("message", (msg) => {
                const data = JSON.parse(msg.toString());
                if (data.event === "media") {
                    this.voiceService.sendAudio(data.media.payload);
                } else if (data.event === "mark") {
                    this.voiceService.handleMark(data.markName);
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
        });
    }
}
