// src/clients/ElevenLabsClient.ts
import WebSocket from "ws";
import { Writable } from "stream";
import * as fs from "fs";
import * as path from "path";

export class ElevenLabsClient {
    private mainOutputStream: Writable | null = null;
    private readonly voiceId = process.env.ELEVENLABS_VOICE_ID!;
    private readonly apiKey  = process.env.ELEVENLABS_API_KEY!;

    public connect(outputStream: Writable) {
        this.mainOutputStream = outputStream;
    }

    public speak(text: string, onStreamStart?: () => void) {
        if (!this.mainOutputStream) {
            console.error("[ElevenLabs] Output stream is not set. Call connect() first.");
            return;
        }

        // --- Start of Debugging Code ---
        const tempDir = path.join(__dirname, '..', '..', 'public', 'tmp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const filePath = path.join(tempDir, `elevenlabs_output_${Date.now()}.mp3`);
        const fileStream = fs.createWriteStream(filePath);
        console.log(`[ElevenLabs Debug] Saving audio to: ${filePath}`);
        // --- End of Debugging Code ---

        const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream-input?model_id=eleven_multilingual_v2`;
        const ws = new WebSocket(url, { headers: { "xi-api-key": this.apiKey } });
        let streamStarted = false;

        ws.on("open", () => {
            ws.send(JSON.stringify({
                voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                // Requesting MP3 for debugging
                output_format: "mp3_44100_128",
                text: " "
            }));
            ws.send(JSON.stringify({ text }));
            ws.send(JSON.stringify({ text: "" }));
        });

        ws.on("message", (data) => {
            const res = JSON.parse(data.toString());
            if (res.audio) {
                const audioChunk = Buffer.from(res.audio, "base64");
                
                // --- Start of Debugging Code ---
                fileStream.write(audioChunk);
                // --- End of Debugging Code ---

                if (!streamStarted) {
                    onStreamStart?.();
                    streamStarted = true;
                }
                // Do not send MP3 data to the main output stream meant for Twilio
                // this.mainOutputStream!.write(audioChunk);
            }
        });

        ws.on("close", (code, reason) => {
            // --- Start of Debugging Code ---
            fileStream.end();
            console.log(`[ElevenLabs Debug] Finished writing to ${filePath}`);
            // --- End of Debugging Code ---
            if (code !== 1000) {
                console.error(`[ElevenLabs] WS closed unexpectedly. code=${code}, reason=${reason}`);
            }
        });

        ws.on("error", (err) => {
            console.error("[ElevenLabs] Connection error:", err);
            fileStream.end();
        });
    }

    public close() {
        this.mainOutputStream = null;
    }
}
