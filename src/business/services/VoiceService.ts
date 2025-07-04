
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
    private callSid: string | null = null;

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
        this.callSid = callSid;
        console.log(`[${callSid}] Starting streaming pipeline...`);

        this.twilioInput = new PassThrough();
        this.deepgramInput = new PassThrough();
        this.chatGptInput = new PassThrough();
        this.elevenLabsInput = new PassThrough();
        this.twilioOutput = this.createTwilioOutput(ws, callSid);

        this.setupPipeline();

        try {
            // Start alle clients en wacht tot ze klaar zijn
            await Promise.all([
                this.deepgramClient.start(this.deepgramInput, this.chatGptInput),
                this.chatGptClient.start(this.chatGptInput, this.elevenLabsInput),
                this.elevenLabsClient.start(this.elevenLabsInput, this.twilioOutput),
            ]);

            // Nu alle clients klaar zijn, speel de welkomstboodschap af
            this.sendWelcomeMessage();
            console.log(`[${callSid}] Streaming pipeline started successfully.`);

        } catch (err) {
            console.error(`[${callSid}] Failed to start streaming pipeline:`, err);
            this.stopStreaming();
        }
    }

    /**
     * Stopt de streaming-pipeline.
     */
    stopStreaming() {
        console.log(`[${this.callSid}] Stopping streaming pipeline.`);
        this.twilioInput?.end();
        this.deepgramInput?.end();
        this.chatGptInput?.end();
        this.elevenLabsInput?.end();
    }

    /**
     * Ontvangt audio van de WebSocket en stuurt het de pipeline in.
     */
    sendAudio(audioChunk: string) {
        this.twilioInput.write(Buffer.from(audioChunk, "base64"));
    }

    /**
     * Verwerk een 'mark' bericht van Twilio om de verbinding levend te houden.
     */
    handleMark(markName: string) {
        console.log(`[${this.callSid}] Received mark: ${markName}`);
    }

    private sendWelcomeMessage() {
        const welcomeText = "Hallo, hoe kan ik je helpen vandaag?";
        console.log(`[${this.callSid}] Sending welcome message: "${welcomeText}"`);
        this.elevenLabsInput.write(welcomeText);
    }

    /**
     * Verbindt de verschillende streams met elkaar.
     */
    private setupPipeline() {
        const pcmStream = this.convertMuLawToPcm(this.twilioInput);
        pcmStream.pipe(this.deepgramInput);
    }

    /**
     * Creëert een Writable stream die audio chunks naar de Twilio WebSocket stuurt.
     */
    private createTwilioOutput(ws: WebSocket, callSid: string): Writable {
        return new Writable({
            write: (chunk, encoding, callback) => {
                const pcmBuffer = Buffer.from(chunk);
                const muLawBuffer = this.convertPcmToMuLaw(pcmBuffer);
                const base64 = muLawBuffer.toString("base64");

                ws.send(
                    JSON.stringify({
                        event: "media",
                        streamSid: callSid,
                        media: { payload: base64 },
                    })
                );
                callback();
            },
        });
    }

    // ... (mu-law conversie functies blijven hetzelfde)
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

