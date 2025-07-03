
// src/clients/DeepgramClient.ts
import { createClient, DeepgramClient as SDKClient } from "@deepgram/sdk";
import { Readable, Writable } from "stream";
import { injectable } from "tsyringe";

@injectable()
export class DeepgramClient {
    private deepgram: SDKClient;

    constructor() {
        this.deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
    }

    /**
     * Start een real-time transcriptie-stream met Deepgram.
     */
    async start(inputStream: Readable, outputStream: Writable) {
        const transcription = this.deepgram.listen.live({
            language: "nl",
            punctuate: true,
            smart_format: true,
            model: "nova-2",
            encoding: "linear16",
            sample_rate: 16000,
        });

        // Event: verbinding is open
        transcription.on("open", () => {
            console.log("[Deepgram] Connection opened.");

            // Pipe de inkomende audio naar Deepgram
            inputStream.on('data', (chunk) => {
                transcription.send(chunk);
            });

            inputStream.on('end', () => {
                transcription.finish();
            });

            // Event: transcriptie is beschikbaar
            transcription.on("transcript", (data) => {
                const transcript = data.channel.alternatives[0].transcript;
                if (transcript) {
                    console.log(`[Deepgram] Transcript: ${transcript}`);
                    outputStream.write(transcript);
                }
            });

            // Event: verbinding is gesloten
            transcription.on("close", () => {
                console.log("[Deepgram] Connection closed.");
                outputStream.end();
            });

            // Event: fout opgetreden
            transcription.on("error", (err) => {
                console.error("[Deepgram] Error:", err);
                outputStream.end();
            });
        });
    }
}
