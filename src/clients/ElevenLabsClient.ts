// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private mainOutputStream: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    public connect(outputStream: Writable) {
        this.mainOutputStream = outputStream;
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
            ws.send(JSON.stringify({
                xi_api_key: this.apiKey,
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                output_format: "ulaw_8000",
                text: " "
            }));

            ws.send(JSON.stringify({ text }));

            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", data => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                if (!streamStarted) {
                    onStreamStart?.();
                    streamStarted = true;
                }
                this.mainOutputStream!.write(Buffer.from(res.audio, "base64"));
            }
        });

        ws.on("close", (code) => {
            if (code !== 1000) {
                 console.error(`[ElevenLabs] Connection closed unexpectedly with code: ${code}`);
            }
        });

        ws.on("error", err => {
            console.error("[ElevenLabs] Connection error:", err);
        });
    }

    public close() {
        this.mainOutputStream = null;
    }
}