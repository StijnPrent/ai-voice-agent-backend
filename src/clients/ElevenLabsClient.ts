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

        // The API key is now sent in the initial message, not the headers.
        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        const ws = new WebSocket(url);
        let streamStarted = false;

        ws.on("open", () => {
            console.log(`[ElevenLabs] On-demand connection opened. Authenticating and sending text: "${text}"`);

            // 1. Send authentication and configuration
            ws.send(JSON.stringify({
                xi_api_key: this.apiKey, // Correct authentication method
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
            }));

            // 2. Send the text to be synthesized
            ws.send(JSON.stringify({ text }));

            // 3. Mark the end of the input stream
            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", data => {
            const res = JSON.parse(data.toString());

            // Check for audio and pipe it to the main stream
            if (res.audio) {
                if (!streamStarted) {
                    console.log("[ElevenLabs] Audio stream started.");
                    onStreamStart?.(); // Trigger the callback to send the Twilio <mark>
                    streamStarted = true;
                }
                this.mainOutputStream!.write(Buffer.from(res.audio, "base64"));
            }

            // Check for an error message from ElevenLabs
            if (res.isFinal && res.message) {
                 console.error(`[ElevenLabs] Received error message: ${res.message}`);
            }
        });

        ws.on("close", (code, reason) => {
            console.log(`[ElevenLabs] On-demand connection closed. Code: ${code}, Reason: ${reason.toString()}`);
            if (!streamStarted) {
                console.error("[ElevenLabs] CRITICAL: Connection closed without streaming any audio. Please check API key and voice ID.");
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