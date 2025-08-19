// src/clients/DeepgramClient.ts
import {
    createClient,
    DeepgramClient as SDKClient,
    LiveTranscriptionEvents,
} from "@deepgram/sdk";
import { Readable, Writable } from "stream";
import { injectable } from "tsyringe";
import config from "../config/config";

type FlushReason = "utterance" | "failsafe";

@injectable()
export class DeepgramClient {
    private deepgram: SDKClient;

    constructor() {
        this.deepgram = createClient(config.deepgramKey);
    }

    /**
     * Start a real-time transcriptie-stream met Deepgram.
     * - Flusht ALLEEN bij UtteranceEnd (of na 2s failsafe-stilte)
     * - VAD events ingeschakeld
     * - Lagere endpointing voor snellere turn-taking
     */
    async start(inputStream: Readable, outputStream: Writable): Promise<void> {
        // Set up a live connection
        const transcription = this.deepgram.listen.live({
            language: "nl",
            model: "nova-2",
            encoding: "mulaw",
            sample_rate: 8000,
            punctuate: true,
            smart_format: true,
            endpointing: 800, // was 800; sneller einde van een uiting detecteren
            vad_events: true, // ontvang UtteranceEnd events
        });

        // Wait until the socket is open or error out
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

        // Forward audio to Deepgram
        const handleData = (chunk: Buffer) => {
            try {
                transcription.send(chunk);
            } catch (e) {
                console.error("[Deepgram] send() failed:", e);
            }
        };
        const handleEnd = () => {
            try {
                transcription.finish();
            } catch (e) {
                console.error("[Deepgram] finish() failed:", e);
            }
        };

        inputStream.on("data", handleData);
        inputStream.once("end", handleEnd);
        inputStream.once("error", (e) => {
            console.error("[Deepgram] input stream error:", e);
            // Best-effort close
            try { transcription.finish(); } catch {}
        });

        // ---- BUFFER LOGICA (utterance-based) ----
        let buf = "";
        let failsafeTimer: NodeJS.Timeout | null = null;
        let closed = false;

        const clearFailsafe = () => {
            if (failsafeTimer) {
                clearTimeout(failsafeTimer);
                failsafeTimer = null;
            }
        };

        const startFailsafe = () => {
            clearFailsafe();
            // Als 2s geen UtteranceEnd komt, toch flushen (lange pauze)
            failsafeTimer = setTimeout(() => flushNow("failsafe"), 2000);
        };

        const flushNow = (reason: FlushReason) => {
            if (!buf.trim()) {
                clearFailsafe();
                return;
            }
            const text = buf.trim();
            console.log(`[Deepgram] Flush (${reason}):`, text);
            try {
                outputStream.write(text);
            } catch (e) {
                console.error("[Deepgram] outputStream.write error:", e);
            }
            buf = "";
            clearFailsafe();
        };

        // Consume only FINAL transcript pieces; do NOT flush on punctuation
        transcription.on(LiveTranscriptionEvents.Transcript, (data: any) => {
            const transcript = data?.channel?.alternatives?.[0]?.transcript ?? "";
            const isFinal = Boolean(data?.is_final);

            if (transcript && isFinal) {
                buf += (buf ? " " : "") + transcript;
                // We wachten op UtteranceEnd; start failsafe mocht het lang stil zijn
                startFailsafe();
            }
        });

        // Flush when Deepgram detects end of utterance
        transcription.on(LiveTranscriptionEvents.UtteranceEnd, () => {
            flushNow("utterance");
        });

        // Handle remote close
        transcription.on(LiveTranscriptionEvents.Close, () => {
            if (closed) return;
            console.log("[Deepgram] Connection closed.");
            closed = true;
            try {
                flushNow("utterance"); // laatste restje
                outputStream.end();
            } catch (e) {
                console.error("[Deepgram] outputStream.end error:", e);
            }

            // Clean up listeners
            inputStream.off("data", handleData);
        });

        // Defensive: also end output if caller closes it first
        outputStream.once("close", () => {
            try {
                transcription.finish();
            } catch {}
        });
    }
}
