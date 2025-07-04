// src/clients/ElevenLabsClient.ts
import { Readable, Writable } from "stream";
import { injectable } from "tsyringe";
import WebSocket from "ws";

@injectable()
export class ElevenLabsClient {
    /**
     * Starts a streaming TTS session with ElevenLabs via WebSocket.
     * Creates a dedicated WebSocket connection for the given input stream.
     * Returns a Promise that resolves when the audio has been fully streamed and the connection is closed.
     */
    start(inputStream: Readable, outputStream: Writable): Promise<void> {
        return new Promise((resolve, reject) => {
            const voiceId = process.env.ELEVENLABS_VOICE_ID!;
            const apiKey  = process.env.ELEVENLABS_API_KEY!;
            const model   = "eleven_multilingual_v2";
            const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}`;

            const ws = new WebSocket(wsUrl, {
                headers: { "xi-api-key": apiKey },
            });

            ws.on("open", () => {
                console.log("[ElevenLabs] Connection opened.");
                ws.send(JSON.stringify({
                    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                    output_format: "ulaw_8000",
                }));
                ws.send(JSON.stringify({ text: " " })); // Send a space to keep the connection alive
            });

            ws.on("message", (data: Buffer) => {
                const res = JSON.parse(data.toString());
                if (res.audio) {
                    outputStream.write(Buffer.from(res.audio, "base64"));
                }
            });

            ws.on("close", () => {
                console.log("[ElevenLabs] Connection closed.");
                resolve(); // Resolve the promise when the connection closes
            });

            ws.on("error", (err) => {
                console.error("[ElevenLabs] Connection error:", err);
                reject(err); // Reject the promise on error
            });

            // Pipe the input stream to the WebSocket
            inputStream.on("data", (chunk) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ text: chunk.toString() }));
                }
            });

            inputStream.on("end", () => {
                if (ws.readyState === WebSocket.OPEN) {
                    // Signal that we're done sending text
                    ws.send(JSON.stringify({ text: "" }));
                }
            });
        });
    }
}