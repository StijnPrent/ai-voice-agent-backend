
// src/clients/DeepgramClient.ts
import { createClient, DeepgramClient as SDKClient, LiveTranscriptionEvents } from "@deepgram/sdk";
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
     * Retourneert een Promise die oplost zodra de verbinding open is.
     */
    async start(inputStream: Readable, outputStream: Writable): Promise<void> {
        const transcription = this.deepgram.listen.live({
            language: "nl",
            punctuate: true,
            smart_format: true,
            model: "nova-2",
            encoding: "linear16",
            sample_rate: 16000,
            endpointing: 300, // Stuur transcriptie na 300ms stilte
            utterance_end_ms: 1000, // Einde van een uiting na 1s stilte
        });

        // Wacht tot de verbinding daadwerkelijk open is
        await new Promise<void>((resolve, reject) => {
            transcription.on(LiveTranscriptionEvents.Open, () => {
                console.log("[Deepgram] Connection opened.");
                resolve();
            });

            transcription.on(LiveTranscriptionEvents.Error, (err) => {
                console.error("[Deepgram] Connection error:", err);
                reject(err);
            });
        });

        // Nu de verbinding open is, kunnen we de rest van de listeners opzetten
        inputStream.on('data', (chunk) => {
            transcription.send(chunk);
        });

        inputStream.on('end', () => {
            transcription.finish();
        });

        transcription.on(LiveTranscriptionEvents.Transcript, (data) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript && data.is_final) {
                console.log(`[Deepgram] Final Transcript: ${transcript}`);
                outputStream.write(transcript);
            }
        });

        transcription.on(LiveTranscriptionEvents.Close, () => {
            console.log("[Deepgram] Connection closed.");
            outputStream.end();
        });
    }
}
