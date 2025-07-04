// src/clients/ElevenLabsClient.ts
import { Readable, Writable } from "stream";
import { injectable } from "tsyringe";
import WebSocket from "ws";

@injectable()
export class ElevenLabsClient {
    private ws!: WebSocket;

    /**
     * Start een streaming TTS-sessie met ElevenLabs via WebSocket.
     * Retourneert een Promise die oplost zodra de verbinding open is.
     */
    async start(inputStream: Readable, outputStream: Writable): Promise<void> {
        const voiceId = process.env.ELEVENLABS_VOICE_ID!;
        const apiKey  = process.env.ELEVENLABS_API_KEY!;
        const model   = "eleven_multilingual_v2";

        const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}`;
        this.ws = new WebSocket(wsUrl, {
            headers: { "xi-api-key": apiKey },
        });

        // 1️⃣ Register all WS listeners *before* sending anything
        this.ws.on("message", (data: Buffer) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                console.log("[ElevenLabs] Received audio chunk.");
                outputStream.write(Buffer.from(res.audio, "base64"));
            }
        });

        this.ws.on("close", () => {
            console.log("[ElevenLabs] Connection closed.");
            outputStream.end();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] Connection error:", err);
            outputStream.end();
        });

        // 2️⃣ Wait for the socket to open, then send settings + kickoffs
        await new Promise<void>((resolve, reject) => {
            this.ws.on("open", () => {
                console.log("[ElevenLabs] Connection opened.");

                // Send initial voice settings & output format
                this.ws.send(JSON.stringify({
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                    },
                    output_format: "ulaw_8000",
                }));

                // Immediately send an empty text chunk to keep the stream alive
                this.ws.send(JSON.stringify({ text: "" }));

                resolve();
            });

            this.ws.on("error", reject);
        });

        // 3️⃣ Pipe incoming text to ElevenLabs
        inputStream.on("data", (chunk) => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ text: chunk.toString() }));
            }
        });

        inputStream.on("end", () => {
            if (this.ws.readyState === WebSocket.OPEN) {
                // Signal end of text so ElevenLabs will finalize & close
                this.ws.send(JSON.stringify({ text: "" }));
            }
        });
    }
}
