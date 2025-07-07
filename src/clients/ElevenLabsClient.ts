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
            console.log(`[ElevenLabs] On-demand connection opened. Sending combined auth and text message...`);

            // Send a single message with authentication, settings, and the text.
            // We no longer send an empty string afterwards, as that was prematurely closing the connection.
            ws.send(JSON.stringify({
                xi_api_key: this.apiKey,
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                text: text,
            }));
        });

        ws.on("message", data => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                if (!streamStarted) {
                    console.log("[ElevenLabs] Audio stream started.");
                    onStreamStart?.();
                    streamStarted = true;
                }
                this.mainOutputStream!.write(Buffer.from(res.audio, "base64"));
            }
        });

        ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] On-demand connection closed. Code: ${code}, Reason: ${reason.toString()}`);
            if (!streamStarted && code !== 1000) {
                 console.error("[ElevenLabs] CRITICAL: Connection closed unexpectedly without streaming audio. Please check server status or account settings.");
            }
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