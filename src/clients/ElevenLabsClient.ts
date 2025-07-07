// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private mainOutputStream: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    public connect(outputStream: Writable) {
        this.mainOutputStream = outputStream;
        console.log("[ElevenLabs] Client initialized. Will connect on-demand.");
    }

    public speak(text: string, onStreamStart?: () => void) {
        if (!this.mainOutputStream) {
            console.error("[ElevenLabs] Output stream is not set. Call connect() first.");
            return;
        }

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        const ws = new WebSocket(url);
        let streamStarted = false;

        ws.on("open", () => {
            console.log(`[ElevenLabs] Connection opened. Sending messages in sequence...`);

            // 1. Send authentication and configuration message.
            ws.send(JSON.stringify({
                xi_api_key: this.apiKey,
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                output_format: "ulaw_8000",
                text: ' '
            }));

            // 2. Send the text message.
            ws.send(JSON.stringify({
                text: text,
            }));

            ws.send(JSON.stringify({
                text: '',
            }));

            // We no longer send the end-of-stream message, as this was the cause of the premature close.
            console.log("[ElevenLabs] Configuration and text sent.");
        });

        ws.on("message", data => {
            const res = JSON.parse(data.toString());
            console.log("[ElevenLabs] Received message:", res);
            if (res.audio) {
                if (!streamStarted) {
                    console.log("[ElevenLabs] Audio stream started.");
                    onStreamStart?.();
                    streamStarted = true;
                }
                this.mainOutputStream!.write(Buffer.from(res.audio, "base64"));
            } else {
                console.log("[ElevenLabs] Received non-audio message:", res);
            }
        });

        ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] On-demand connection closed. Code: ${code}, Reason: ${reason.toString()}`);
        });

        ws.on("error", err => {
            console.error("[ElevenLabs] On-demand connection error:", err);
        });
    }

    public close() {
        console.log("[ElevenLabs] Client shutting down.");
        this.mainOutputStream = null;
    }
}
