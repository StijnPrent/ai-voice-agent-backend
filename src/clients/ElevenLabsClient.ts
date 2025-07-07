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
        const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        let streamStarted = false;

        ws.on("open", () => {
            // Send authentication/config + prime
            ws.send(JSON.stringify({
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                output_format: "ulaw_8000",
                text: " "
            }));
            // Send text + end-of-input
            ws.send(JSON.stringify({ text }));
            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", (data) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                if (!streamStarted) {
                    onStreamStart?.();
                    streamStarted = true;
                }
                this.mainOutputStream!.write(Buffer.from(res.audio, "base64"));
            }
        });

        ws.on("close", (code, reason) => {
            if (code !== 1000) {
                console.error(`[ElevenLabs] WS closed unexpectedly. code=${code}, reason=${reason}`);
            }
        });

        ws.on("error", (err) => {
            console.error("[ElevenLabs] Connection error:", err);
        });
    }

    public close() {
        this.mainOutputStream = null;
    }
}