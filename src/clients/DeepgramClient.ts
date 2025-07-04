
// src/clients/DeepgramClient.ts
import {
    createClient,
    DeepgramClient as SDKClient,
    LiveTranscriptionEvents,
} from "@deepgram/sdk";
import WebSocket from "ws";
import { Readable, Writable } from "stream";
import { injectable } from "tsyringe";
import config from "../config/config";

@injectable()
export class DeepgramClient {
    private deepgram: SDKClient;

    constructor() {
        this.deepgram = createClient(config.deepgramKey);
    }

    /**
     * Start een real-time transcriptie-stream met Deepgram.
     * Retourneert een Promise die oplost zodra de verbinding open is.
     */
    async start(inputStream: Readable, outputStream: Writable): Promise<void> {
        const transcription = this.deepgram.listen.live({
            language: "nl",
            model: "nova-2",
            encoding: "linear16",
            sample_rate: 8000,
            punctuate: true,
            smart_format: true,
        });

        // Wacht tot de verbinding daadwerkelijk open is
        await new Promise<void>((resolve, reject) => {
            transcription.on(LiveTranscriptionEvents.Open, () => {
                console.log("[Deepgram] Connection opened.");
                resolve();
            });

            transcription.on(LiveTranscriptionEvents.Error, (err: any) => {
                // Log the full error object for detailed diagnostics
                console.error("[Deepgram] Connection error:", JSON.stringify(err, null, 2));
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

        transcription.on(LiveTranscriptionEvents.Transcript, (data: any) => {
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
