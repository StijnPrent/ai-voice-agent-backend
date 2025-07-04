// src/clients/ElevenLabsClient.ts
import { Writable } from "stream";
import { injectable } from "tsyringe";
import WebSocket from "ws";

@injectable()
export class ElevenLabsClient {
    /**
     * Converts text to speech and streams the audio to the provided Writable stream.
     * This method handles the entire lifecycle of the WebSocket connection for a single TTS request.
     *
     * @param text The text to be converted to speech.
     * @param outputStream The stream to write the resulting audio data to.
     * @returns A Promise that resolves when the audio has been fully streamed.
     */
    start(text: string, outputStream: Writable): Promise<void> {
        return new Promise((resolve, reject) => {
            const voiceId = process.env.ELEVENLABS_VOICE_ID!;
            const apiKey = process.env.ELEVENLABS_API_KEY!;
            const model = "eleven_multilingual_v2";
            const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${model}`;

            const ws = new WebSocket(wsUrl, {
                headers: { "xi-api-key": apiKey },
            });

            ws.on("open", () => {
                console.log("[ElevenLabs] Connection opened for TTS.");
                // Send initial configuration
                ws.send(JSON.stringify({
                    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
                    output_format: "ulaw_8000",
                }));
                // Send the text payload
                ws.send(JSON.stringify({ text }));
                // Signal the end of the text input
                ws.send(JSON.stringify({ text: "" }));
            });

            ws.on("message", (data: Buffer) => {
                try {
                    const res = JSON.parse(data.toString());
                    if (res.audio) {
                        // Write the received audio chunk to the output stream
                        outputStream.write(Buffer.from(res.audio, "base64"));
                    } else if (res.isFinal) {
                        // This marks the end of the stream from ElevenLabs' side.
                        // We can often rely on the 'close' event, but this is a good safeguard.
                    }
                } catch (err) {
                    console.error("[ElevenLabs] Error parsing message:", err);
                }
            });

            ws.on("close", (code, reason) => {
                console.log(`[ElevenLabs] Connection closed. Code: ${code}, Reason: ${reason}`);
                resolve(); // Successfully finished
            });

            ws.on("error", (err) => {
                console.error("[ElevenLabs] WebSocket error:", err);
                reject(err); // Failed
            });
        });
    }
}
