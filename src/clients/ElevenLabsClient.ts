// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private mainOutputStream: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    /**
     * Initializes the client with the main output stream for the call.
     * This stream will live for the entire duration of the call.
     * @param outputStream The stream to write all received audio data to.
     */
    public connect(outputStream: Writable) {
        this.mainOutputStream = outputStream;
        console.log("[ElevenLabs] Client initialized and ready to speak on demand.");
    }

    /**
     * Creates a new, single-use WebSocket connection to synthesize the given text.
     * @param text The text to synthesize.
     */
    public speak(text: string) {
        if (!this.mainOutputStream) {
            console.error("[ElevenLabs] Output stream is not set. Call connect() first.");
            return;
        }

        // Create a new connection for each speech request.
        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey }, handshakeTimeout: 10000 });

        ws.on("open", () => {
            console.log(`[ElevenLabs] Speaking: "${text}"`);
            // Send initial configuration
            ws.send(JSON.stringify({
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                output_format:  "ulaw_8000"
            }));
            // Send the text to be spoken
            ws.send(JSON.stringify({ text }));
            // Mark the end of the input stream.
            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", data => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                // Pipe audio to the main, persistent output stream
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

    /**
     * This client no longer manages a persistent connection,
     * so close() is now a no-op for cleanup consistency.
     */
    public close() {
        console.log("[ElevenLabs] Client shutting down.");
        this.mainOutputStream = null;
    }
}