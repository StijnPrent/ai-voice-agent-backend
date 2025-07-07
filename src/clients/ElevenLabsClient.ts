// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private mainOutputStream: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    /**
     * Initializes the client with the main output stream for the call.
     * @param outputStream The stream to write all received audio data to.
     */
    public connect(outputStream: Writable) {
        this.mainOutputStream = outputStream;
        console.log("[ElevenLabs] Client initialized and ready to speak on demand.");
    }

    /**
     * Creates a new, single-use WebSocket connection to synthesize the given text.
     * @param text The text to synthesize.
     * @param onStreamStart Optional callback to be executed when the audio stream begins.
     */
    public speak(text: string, onStreamStart?: () => void) {
        if (!this.mainOutputStream) {
            console.error("[ElevenLabs] Output stream is not set. Call connect() first.");
            return;
        }

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        let streamStarted = false;

        ws.on("open", () => {
            console.log(`[ElevenLabs] Speaking: "${text}"`);
            ws.send(JSON.stringify({
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                output_format:  "ulaw_8000"
            }));
            ws.send(JSON.stringify({ text }));
            ws.send(JSON.stringify({ text: "" }));
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

        ws.on("close", (code) => {
            console.log(`[ElevenLabs] Single-use connection closed. Code: ${code}`);
        });

        ws.on("error", err => {
            console.error("[ElevenLabs] Single-use connection error:", err);
        });
    }

    public close() {
        console.log("[ElevenLabs] Client shutting down.");
        this.mainOutputStream = null;
    }
}
