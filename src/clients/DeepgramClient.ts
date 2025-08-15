// src/clients/DeepgramClient.ts
import {
    createClient,
    DeepgramClient as SDKClient,
    LiveTranscriptionEvents,
} from "@deepgram/sdk";
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
     * Start a real-time transcriptie-stream met Deepgram.
     * Retourneert een Promise die oplost zodra de verbinding open is.
     */
    async start(inputStream: Readable, outputStream: Writable): Promise<void> {
        const transcription = this.deepgram.listen.live({
            language: "nl",
            model: "nova-2",
            encoding: "mulaw",
            sample_rate: 8000,
            punctuate: true,
            smart_format: true,
            endpointing: 800,          // iets langer wachten op stilte
            // vad_events: true,        // zet aan als je UtteranceEnd events wilt (afhankelijk van SDK-versie)
        });

        await new Promise<void>((resolve, reject) => {
            transcription.on(LiveTranscriptionEvents.Open, () => {
                console.log("[Deepgram] Connection opened.");
                resolve();
            });
            transcription.on(LiveTranscriptionEvents.Error, (err: any) => {
                console.error("[Deepgram] Connection error:", JSON.stringify(err, null, 2));
                reject(err);
            });
        });

        // audio naar Deepgram sturen
        inputStream.on("data", (chunk) => transcription.send(chunk));
        inputStream.on("end", () => transcription.finish());

        // ---- BUFFER LOGICA ----
        let buf = "";
        let flushTimer: NodeJS.Timeout | null = null;

        const scheduleFlush = (ms = 1000) => {
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = setTimeout(() => flushNow("debounce"), ms);
        };

        const flushNow = (reason: "utterance" | "debounce" | "punct") => {
            if (!buf.trim()) return;
            const text = buf.trim();
            console.log(`[Deepgram] Flush (${reason}):`, text);
            outputStream.write(text);
            buf = "";
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        };

        const endsSentence = (s: string) => /[.!?…]\s*$/.test(s);

        transcription.on(LiveTranscriptionEvents.Transcript, (data: any) => {
            const transcript = data?.channel?.alternatives?.[0]?.transcript ?? "";
            // We sturen alleen definitieve segmenten door naar de buffer
            if (transcript && data.is_final) {
                // voeg spatie als nodig
                buf += (buf ? " " : "") + transcript;
                // flush snel als het einde van een zin lijkt
                if (endsSentence(buf)) {
                    flushNow("punct");
                } else {
                    // anders debounce tot stilte
                    scheduleFlush(1000); // 1s zonder nieuw final stukje => flush
                }
            }
        });

        // Krijg je UtteranceEnd events? Dan nog betrouwbaarder flushen:
        // transcription.on(LiveTranscriptionEvents.UtteranceEnd, () => flushNow("utterance"));

        transcription.on(LiveTranscriptionEvents.Close, () => {
            console.log("[Deepgram] Connection closed.");
            flushNow("utterance"); // flush resterende buffer
            outputStream.end();
        });
    }
}