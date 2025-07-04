// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private ws!: WebSocket;
    private out!: Writable;

    /** Open the socket once per call. */
    async connect(outputStream: Writable = process.stdout) {
        const voiceId = process.env.ELEVENLABS_VOICE_ID!;
        const apiKey  = process.env.ELEVENLABS_API_KEY!;
        this.out = outputStream;

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        this.ws = new WebSocket(url, { headers: { "xi-api-key": apiKey } });

        // Wire up events *before* open
        this.ws.on("message", data => {
            const res = JSON.parse(data.toString());
            if (res.audio) this.out.write(Buffer.from(res.audio, "base64"));
        });
        this.ws.on("close",  () => this.out.end());
        this.ws.on("error", err => {
            console.error("[ElevenLabs] WS error", err);
            this.out.end();
        });

        // Wait for open & send settings + empty kick-off text
        await new Promise<void>((resolve, reject) => {
            this.ws.on("open", () => {
                console.log("[ElevenLabs] Connection opened");
                this.ws.send(JSON.stringify({
                    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                    output_format:  "ulaw_8000"
                }));
                this.ws.send(JSON.stringify({ text: "" }));
                resolve();
            });
            this.ws.on("error", reject);
        });
    }

    /** Send a sentence (or just text) to be spoken. */
    speak(text: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[ElevenLabs] Speaking:", text);
            this.ws.send(JSON.stringify({ text }));
        } else {
            console.warn("[ElevenLabs] Cannot speak, socket not open");
        }
    }

    /** Close out the TTS socket. */
    close() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
    }
}
