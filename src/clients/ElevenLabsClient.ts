// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private ws: WebSocket | null = null;
    private out: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    /**
     * Opens (or reopens) the ElevenLabs TTS socket.
     */
    public async connect(outputStream: Writable) {
        this.out = outputStream;

        // If already open, nothing to do
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });

        // 1️⃣ Register listeners immediately
        this.ws.on("message", data => {
            if (!this.out) return;
            try {
                const payload = JSON.parse(data.toString());
                if (payload.audio) {
                    // Write raw audio bytes
                    this.out.write(Buffer.from(payload.audio, "base64"));
                }
            } catch (err) {
                console.error("[ElevenLabs] Invalid JSON:", err);
            }
        });

        this.ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] WS closed. code=${code} reason=${reason.toString()}`);
            this.ws = null;
            if (this.out) this.out.end();
        });

        this.ws.on("error", err => {
            console.error("[ElevenLabs] WS error:", err);
            this.ws = null;
            if (this.out) this.out.end();
        });

        // 2️⃣ Wait for the socket to open
        await new Promise<void>((resolve, reject) => {
            this.ws!.on("open", () => {
                console.log("[ElevenLabs] Connection opened");
                // 3️⃣ Send your voice settings
                this.ws!.send(JSON.stringify({
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                    },
                    output_format: "ulaw_8000",
                }));
                // 4️⃣ Prime with an empty text to keep the stream alive
                this.ws!.send(JSON.stringify({ text: "" }));
                resolve();
            });
            this.ws!.on("error", reject);
        });
    }

    /**
     * Sends a chunk of text to be spoken.
     */
    public async speak(text: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn("[ElevenLabs] Socket not open — reconnecting");
            // Re-open using the same output stream
            if (this.out) {
                await this.connect(this.out);
            } else {
                console.error("[ElevenLabs] No output stream to reconnect with");
                return;
            }
        }

        console.log("[ElevenLabs] Sending text:", JSON.stringify(text));
        // Send the actual text
        this.ws!.send(JSON.stringify({ text }));
        // Immediately send an empty text to flush & keep alive
        this.ws!.send(JSON.stringify({ text: "" }));
    }

    /**
     * Closes the socket.
     */
    public close() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[ElevenLabs] Closing connection");
            this.ws.close(1000, "Client requested close");  // use a code/reason
        }
    }
}
