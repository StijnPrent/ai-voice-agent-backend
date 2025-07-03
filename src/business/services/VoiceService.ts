
// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import { PassThrough, Writable } from "stream";
import { DeepgramClient } from "../../clients/DeepgramClient";
import { ChatGPTClient } from "../../clients/ChatGPTClient";
import { ElevenLabsClient } from "../../clients/ElevenLabsClient";

@injectable()
export class VoiceService {
    private deepgramClient: DeepgramClient;
    private chatGptClient: ChatGPTClient;
    private elevenLabsClient: ElevenLabsClient;

    // Streams voor de audio-pipeline
    private twilioInput!: PassThrough;
    private deepgramInput!: PassThrough;
    private chatGptInput!: PassThrough;
    private elevenLabsInput!: PassThrough;
    private twilioOutput!: Writable;

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
     * Start de streaming-pipeline voor een nieuwe call.
     */
    async startStreaming(ws: WebSocket, callSid: string) {
        console.log(`[${callSid}] Starting streaming pipeline...`);

        // 1. Initialiseer alle PassThrough-streams
        this.twilioInput = new PassThrough();
        this.deepgramInput = new PassThrough();
        this.chatGptInput = new PassThrough();
        this.elevenLabsInput = new PassThrough();

        // 2. Maak een Writable stream voor de output naar Twilio
        this.twilioOutput = this.createTwilioOutput(ws, callSid);

        // 3. Koppel de streams aan elkaar
        this.setupPipeline();

        // 4. Start de clients met de juiste streams
        await this.deepgramClient.start(this.deepgramInput, this.chatGptInput);
        await this.chatGptClient.start(this.chatGptInput, this.elevenLabsInput);
        await this.elevenLabsClient.start(this.elevenLabsInput, this.twilioOutput);

        console.log(`[${callSid}] Streaming pipeline started.`);
    }

    /**
     * Stopt de streaming-pipeline.
     */
    stopStreaming() {
        this.twilioInput?.end();
        this.deepgramInput?.end();
        this.chatGptInput?.end();
        this.elevenLabsInput?.end();
        console.log("Streaming pipeline stopped.");
    }

    /**
     * Ontvangt audio van de WebSocket en stuurt het de pipeline in.
     */
    sendAudio(audioChunk: string) {
        // Twilio stuurt audio als base64-encoded string. Decodeer naar een Buffer.
        const buffer = Buffer.from(audioChunk, "base64");
        this.twilioInput.write(buffer);
    }

    /**
     * Verbindt de verschillende streams met elkaar.
     */
    private setupPipeline() {
        // Converteer Twilio's 8-bit mu-law audio naar 16-bit PCM voor Deepgram
        const pcmStream = this.convertMuLawToPcm(this.twilioInput);

        // Pipe de geconverteerde audio naar de Deepgram-client
        pcmStream.pipe(this.deepgramInput);
    }

    /**
     * Creëert een Writable stream die audio chunks naar de Twilio WebSocket stuurt.
     */
    private createTwilioOutput(ws: WebSocket, callSid: string): Writable {
        return new Writable({
            write: (chunk, encoding, callback) => {
                // Converteer de audio chunk (PCM) terug naar mu-law en base64
                const pcmBuffer = Buffer.from(chunk);
                const muLawBuffer = this.convertPcmToMuLaw(pcmBuffer);
                const base64 = muLawBuffer.toString("base64");

                // Stuur als 'media' event naar Twilio
                ws.send(
                    JSON.stringify({
                        event: "media",
                        streamSid: callSid, // Belangrijk: streamSid is hier callSid
                        media: {
                            payload: base64,
                        },
                    })
                );
                callback();
            },
        });
    }

    /**
     * Converteert een 8-bit mu-law stream naar 16-bit PCM.
     * Dit is nodig omdat Deepgram een hogere kwaliteit audio verwacht.
     */
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

    /**
     * Converteert een 16-bit PCM buffer terug naar 8-bit mu-law.
     */
    private convertPcmToMuLaw(pcmBuffer: Buffer): Buffer {
        const muLawBuffer = Buffer.alloc(pcmBuffer.length / 2);
        for (let i = 0; i < muLawBuffer.length; i++) {
            const pcm = pcmBuffer.readInt16LE(i * 2);
            muLawBuffer[i] = this.pcmToMuLaw(pcm);
        }
        return muLawBuffer;
    }

    // Mu-law conversie functies (standaard algoritmes)
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

