// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import { PassThrough, Writable } from "stream";
import { DeepgramClient } from "../../clients/DeepgramClient";
import { ChatGPTClient } from "../../clients/ChatGPTClient";
import { ElevenLabsClient } from "../../clients/ElevenLabsClient";

@injectable()
export class VoiceService {
    // Keep the clients injected
    private deepgramClient: DeepgramClient;
    private chatGptClient: ChatGPTClient;
    private elevenLabsClient: ElevenLabsClient;

    // Streams for the INPUT pipeline (listening to the user)
    private twilioInput!: PassThrough;
    private deepgramInput!: PassThrough;
    private chatGptInput!: PassThrough;

    // The output stream to Twilio. This can be reused.
    private twilioOutput!: Writable;

    // Call identifiers
    private callSid: string | null = null;
    private streamSid: string | null = null;
    private isStreaming: boolean = false;

    constructor(
        @inject(DeepgramClient) deepgramClient: DeepgramClient,
        @inject(ChatGPTClient) chatGptClient: ChatGPTClient,
        @inject(ElevenLabsClient) elevenLabsClient: ElevenLabsClient
    ) {
        this.deepgramClient = deepgramClient;
        this.chatGptClient = chatGptClient;
        this.elevenLabsClient = elevenLabsClient;
    }

    /**
     * Starts the streaming pipeline for a new call.
     * This now only sets up the "listening" part of the pipeline.
     */
    async startStreaming(ws: WebSocket, callSid: string, streamSid: string) {
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.isStreaming = true;
        console.log(`[${callSid}] Starting streaming pipeline...`);

        // 1. Initialize streams for the input pipeline
        this.twilioInput = new PassThrough();
        this.deepgramInput = new PassThrough();
        this.chatGptInput = new PassThrough();
        this.twilioOutput = this.createTwilioOutput(ws);

        // 2. Connect the input streams (Twilio -> Deepgram)
        const pcmStream = this.convertMuLawToPcm(this.twilioInput);
        pcmStream.pipe(this.deepgramInput);

        try {
            // 3. Start the listening clients
            //    We assume ChatGPTClient is modified to take a callback instead of an output stream.
            //    This is crucial for decoupling the speaking part.
            await this.deepgramClient.start(this.deepgramInput, this.chatGptInput);

            // The `onTextGenerated` callback will trigger the `speak` method.
            this.chatGptClient.start(this.chatGptInput, async (text) => {
                try {
                    await this.speak(text);
                } catch (err) {
                    console.error(`[${this.callSid}] Error in speak callback:`, err);
                }
            });

            // 4. Play the welcome message by calling the new speak method
            await this.speak("Hallo, hoe kan ik je helpen vandaag?");

            console.log(`[${callSid}] Streaming pipeline started successfully.`);

        } catch (err) {
            console.error(`[${callSid}] Failed to start streaming pipeline:`, err);
            this.stopStreaming();
        }
    }

    /**
     * A new method to handle text-to-speech on demand.
     * This creates a short-lived pipeline for each utterance.
     */
    private async speak(text: string) {
        if (!text) return;
        console.log(`[${this.callSid}] Preparing to speak: "${text}"`);

        // Create a new, temporary stream for this specific text
        const elevenLabsInputStream = new PassThrough();

        try {
            // Start a new ElevenLabs streaming session and wait for it to complete.
            const ttsPromise = this.elevenLabsClient.start(elevenLabsInputStream, this.twilioOutput);

            // Write the text to the stream and end it.
            elevenLabsInputStream.write(text);
            elevenLabsInputStream.end();

            // Await the completion of the TTS streaming.
            await ttsPromise;
            console.log(`[${this.callSid}] Finished speaking: "${text}"`);

        } catch (err) {
            console.error(`[${this.callSid}] Error during ElevenLabs TTS streaming:`, err);
        }
    }

    /**
     * Stops the streaming-pipeline by ending the input streams.
     */
    stopStreaming() {
        if (!this.isStreaming) {
            console.log(`[${this.callSid}] Stop ignored: streaming is not active.`);
            return;
        }
        console.log(`[${this.callSid}] Stopping streaming pipeline.`);
        this.isStreaming = false;

        // Only end the streams that are part of the persistent input pipeline
        this.twilioInput?.end();
        this.deepgramInput?.end();
        this.chatGptInput?.end();
    }

    /**
     * Receives audio from the WebSocket and sends it into the listening pipeline.
     */
    sendAudio(audioChunk: string) {
        // Prevent writing to the stream if it has been closed
        if (this.twilioInput && !this.twilioInput.destroyed) {
            this.twilioInput.write(Buffer.from(audioChunk, "base64"));
        }
    }

    handleMark(markName: string) {
        console.log(`[${this.callSid}] Received mark: ${markName}`);
    }

    /**
     * Creates a Writable stream that sends audio chunks to the Twilio WebSocket.
     */
    private createTwilioOutput(ws: WebSocket): Writable {
        return new Writable({
            write: (chunk, encoding, callback) => {
                if (ws.readyState !== WebSocket.OPEN) {
                    console.log(`[${this.callSid}] WebSocket not open, skipping media send.`);
                    callback();
                    return;
                }

                // De audio is al in base64-gecodeerde mu-law, dus we kunnen het direct doorsturen.
                const base64 = chunk.toString('base64');
                console.log(`[${this.callSid}] Sending audio chunk to Twilio.`);

                ws.send(
                    JSON.stringify({
                        event: "media",
                        streamSid: this.streamSid,
                        media: { payload: base64 },
                    })
                );
                callback();
            },
            destroy: (err, callback) => {
                console.log(`[${this.callSid}] Twilio output stream destroyed.`);
                callback(err);
            }
        });
    }

    // --- Mu-law conversion functions are no longer needed here ---
    private convertMuLawToPcm(muLawStream: PassThrough): PassThrough {
        const pcmStream = new PassThrough();
        muLawStream.on("data", (chunk) => {
            const pcmChunk = Buffer.alloc(chunk.length * 2);
            for (let i = 0; i < chunk.length; i++) {
                const pcm = this.muLawToPcm(chunk[i]);
                pcmChunk.writeInt16LE(pcm, i * 2);
            }
            pcmStream.write(pcmChunk);
        });
        return pcmStream;
    }

    private convertPcmToMuLaw(pcmBuffer: Buffer): Buffer {
        const muLawBuffer = Buffer.alloc(pcmBuffer.length / 2);
        for (let i = 0; i < muLawBuffer.length; i++) {
            const pcm = pcmBuffer.readInt16LE(i * 2);
            muLawBuffer[i] = this.pcmToMuLaw(pcm);
        }
        return muLawBuffer;
    }

    private muLawToPcm(muLaw: number): number {
        const MU = 255;
        const sign = (muLaw & 0x80) === 0 ? -1 : 1;
        let magnitude = muLaw & 0x7f;
        magnitude = ((Math.pow(1 + MU, magnitude / 128) - 1) / MU) * 32767;
        return sign * magnitude;
    }

    private pcmToMuLaw(pcm: number): number {
        const MU = 255;
        const sign = pcm < 0 ? 0x00 : 0x80;
        const magnitude = Math.min(32767, Math.abs(pcm));
        const muLaw = Math.round(
            (Math.log(1 + (MU * magnitude) / 32767) / Math.log(1 + MU)) * 128
        );
        return sign | (127 - muLaw);
    }
}
