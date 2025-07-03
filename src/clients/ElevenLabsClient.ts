// src/clients/ElevenLabsClient.ts
import { Readable, Writable } from "stream";
import { injectable } from "tsyringe";
import WebSocket from "ws";

@injectable()
export class ElevenLabsClient {
    private ws!: WebSocket;

    /**
     * Start een streaming TTS-sessie met ElevenLabs via WebSocket.
     */
    async start(inputStream: Readable, outputStream: Writable) {
        const voiceId = process.env.ELEVENLABS_VOICE_ID!;
        const apiKey = process.env.ELEVENLABS_API_KEY!;
        const model = "eleven_multilingual_v2";

        const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}`;
        this.ws = new WebSocket(wsUrl, {
            headers: { "xi-api-key": apiKey },
        });

        this.ws.on("open", () => {
            console.log("[ElevenLabs] Connection opened.");
            // Stuur de voice settings
            this.ws.send(JSON.stringify({
                voice_settings: {
                    stability: 0.2,
                    similarity_boost: 0.2,
                },
            }));
        });

        this.ws.on("message", (data: Buffer) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                outputStream.write(Buffer.from(res.audio, "base64"));
            }
        });

        this.ws.on("close", () => {
            console.log("[ElevenLabs] Connection closed.");
            outputStream.end();
        });

        this.ws.on("error", (err) => {
            console.error("[ElevenLabs] Error:", err);
            outputStream.end();
        });

        // Pipe de tekst van ChatGPT naar ElevenLabs
        inputStream.on("data", (chunk) => {
            this.ws.send(JSON.stringify({ text: chunk.toString() }));
        });

        // Als ChatGPT stopt met praten, stuur een lege string om de stream te flushen
        inputStream.on("end", () => {
            this.ws.send(JSON.stringify({ text: "" }));
        });
    }
}
