
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
        const apiKey = process.env.ELEVENLABS_API_KEY!;
        const model = "eleven_multilingual_v2";

        const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}`;
        this.ws = new WebSocket(wsUrl, {
            headers: { "xi-api-key": apiKey },
        });

        // Wacht tot de verbinding daadwerkelijk open is
        await new Promise<void>((resolve, reject) => {
            this.ws.on("open", () => {
                console.log("[ElevenLabs] Connection opened.");
                // Stuur de initiële voice settings
                this.ws.send(JSON.stringify({
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                    },
                }));
                resolve(); // Verbinding is klaar voor gebruik
            });

            this.ws.on("error", (err) => {
                console.error("[ElevenLabs] Connection error:", err);
                reject(err);
            });
        });

        // Nu de verbinding open is, kunnen we de rest van de listeners opzetten
        this.ws.on("message", (data: Buffer) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                outputStream.write(Buffer.from(res.audio, "base64"));
            }
        });

        this.ws.on("close", () => {
            console.log("[ElevenLabs] Connection closed.");
        });

        // Pipe de tekst van ChatGPT naar ElevenLabs
        inputStream.on("data", (chunk) => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ text: `${chunk.toString()} ` })); // Spatie toevoegen voor betere flow
            }
        });

        // Als ChatGPT stopt met praten, stuur een lege string om de stream te flushen
        inputStream.on("end", () => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ text: "" }));
            }
        });
    }
}

