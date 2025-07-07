// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";

export class ElevenLabsClient {
    private ws: WebSocket | null = null;
    private out: Writable | null = null;
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    /**
     * Establishes and maintains a WebSocket connection to ElevenLabs.
     * @param outputStream The stream to write the received audio data to.
     */
    public async connect(outputStream: Writable) {
        this.out = outputStream;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return; // Connection is already open
        }

        // Clean up any previous connection artifacts
        this.close();

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        this.ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });

        this.ws.on("message", data => {
            if (!this.out) return;
            const res = JSON.parse(data.toString());
            if (res.audio) {
                this.out.write(Buffer.from(res.audio, "base64"));
            }
        });

        this.ws.on("pong", () => {
            // console.log("[ElevenLabs] Received pong from server."); // Optional: for debugging
        });

        this.ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] WS connection closed. Code: ${code}, Reason: ${reason.toString()}`);
            this.close(); // Clean up resources
        });

        this.ws.on("error", err => {
            console.error("[ElevenLabs] WS error", err);
            this.close(); // Clean up resources
        });

        await new Promise<void>((resolve, reject) => {
            this.ws!.on("open", () => {
                console.log("[ElevenLabs] Connection opened");

                // Start sending pings to keep the connection alive
                this.keepAliveInterval = setInterval(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.ping();
                    }
                }, 5000);

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
     * Sends text to be spoken.
     * @param text The text to synthesize.
     */
    public async speak(text: string) {
        if (!this.out) {
            console.error("[ElevenLabs] Output stream is not set. Call connect() first.");
            return;
        }

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
             console.log("[ElevenLabs] Connection is not open, attempting to reconnect...");
             await this.connect(this.out);
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ text }));
        } else {
            console.warn("[ElevenLabs] Cannot speak, socket not ready after attempting to connect.");
        }
    }

    /** Cleans up the connection and stops the keep-alive pings. */
    public close() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            this.ws.removeAllListeners(); // Avoid memory leaks
            this.ws = null;
        }
    }
}
