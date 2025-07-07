// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private ws: WebSocket | null = null;
    private out: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    /**
     * Ensures the WebSocket connection to ElevenLabs is open.
     * If the connection is closed or doesn't exist, it establishes a new one.
     * @param outputStream The stream to write the received audio data to.
     */
    public async connect(outputStream: Writable) {
        this.out = outputStream;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return; // Connection is already open
        }

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });

        this.ws.on("message", data => {
            if (!this.out) return;
            const res = JSON.parse(data.toString());
            if (res.audio) {
                this.out.write(Buffer.from(res.audio, "base64"));
            }
        });

        this.ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] WS connection closed. Code: ${code}, Reason: ${reason.toString()}`);
            this.ws = null; // Mark as closed
        });

        this.ws.on("error", err => {
            console.error("[ElevenLabs] WS error", err);
            this.ws = null; // Mark as closed
        });

        // Wait for the connection to open before proceeding
        await new Promise<void>((resolve, reject) => {
            this.ws!.on("open", () => {
                console.log("[ElevenLabs] Connection opened");
                // Send initial configuration
                this.ws!.send(JSON.stringify({
                    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                    output_format:  "ulaw_8000"
                }));
                // Prime the connection with a space to start the audio flow.
                this.ws!.send(JSON.stringify({ text: " " }));
                resolve();
            });
            this.ws!.on("error", (err) => {
                console.error("[ElevenLabs] Connection opening error:", err);
                reject(err);
            });
        });
    }

    /**
     * Sends text to be spoken. Ensures the connection is active before sending.
     * @param text The text to synthesize.
     */
    public async speak(text: string) {
        if (!this.out) {
            console.error("[ElevenLabs] Output stream is not set. Call connect() first.");
            return;
        }
        // Ensure connection is alive before speaking
        await this.connect(this.out);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[ElevenLabs] Speaking:", text);
            // Send the actual text
            this.ws.send(JSON.stringify({ text }));
            // Send a space immediately after to keep the connection alive
            this.ws.send(JSON.stringify({ text: " " }));
        } else {
            console.warn("[ElevenLabs] Cannot speak, socket not open or ready.");
        }
    }

    /** Closes the WebSocket connection if it's open. */
    public close() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log("[ElevenLabs] Closing connection.");
            this.ws.close();
        }
    }
}