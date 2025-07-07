// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import { PassThrough, Readable, Writable } from "stream";
import { DeepgramClient } from "../../clients/DeepgramClient";
import { ChatGPTClient } from "../../clients/ChatGPTClient";
import { ElevenLabsClient } from "../../clients/ElevenLabsClient";

@injectable()
export class VoiceService {
    private ws: WebSocket | null = null;
    private callSid: string | null = null;
    private streamSid: string | null = null;
    private audioIn: PassThrough | null = null;
    private audioOut: PassThrough | null = null;

    constructor(
        @inject(DeepgramClient) private deepgramClient: DeepgramClient,
        @inject(ChatGPTClient) private chatGptClient: ChatGPTClient,
        @inject(ElevenLabsClient) private elevenLabsClient: ElevenLabsClient
    ) {}

    /**
     * Starts the voice streaming session for a new call.
     */
    public async startStreaming(ws: WebSocket, callSid: string, streamSid: string) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.audioIn = new PassThrough();
        this.audioOut = new PassThrough();

        console.log(`[${this.callSid}] Starting stream...`);

        // 1. Pipe audio from ElevenLabs back to the Twilio WebSocket
        this.audioOut.on('data', (chunk) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                const message = {
                    event: "media",
                    streamSid: this.streamSid,
                    media: {
                        payload: chunk.toString("base64"),
                    },
                };
                this.ws.send(JSON.stringify(message));
            }
        });

        this.audioOut.on('end', () => {
            console.log(`[${this.callSid}] ElevenLabs audio stream ended.`);
        });

        // 2. Create a writable stream for Deepgram transcripts
        const dgToGpt = new Writable({
            write: (chunk: Buffer, _encoding, callback) => {
                const transcript = chunk.toString();
                console.log(`[${this.callSid}] [Deepgram] Transcript:`, transcript);

                // 3. Send transcript to ChatGPT
                this.chatGptClient.start(
                    Readable.from([transcript]),
                    (sentence: string) => {
                        console.log(`[${this.callSid}] [ChatGPT] Sentence:`, sentence);
                        // 4. Send ChatGPT response to ElevenLabs for synthesis
                        this.elevenLabsClient.speak(sentence);
                    }
                ).catch(err => console.error(`[${this.callSid}] ChatGPT error:`, err));

                callback();
            }
        });

        try {
            // 5. Start Deepgram client
            await this.deepgramClient.start(this.audioIn, dgToGpt);
            console.log(`[${this.callSid}] Deepgram pipeline started.`);

            // 6. Connect to ElevenLabs, piping its output to our audioOut stream
            await this.elevenLabsClient.connect(this.audioOut);
            console.log(`[${this.callSid}] ElevenLabs TTS connected.`);

            // 7. Send a welcome message
            this.elevenLabsClient.speak("Hello, how can I help you today?");

        } catch (error) {
            console.error(`[${this.callSid}] Error during service initialization:`, error);
            this.stopStreaming();
        }
    }

    /**
     * Receives audio payload from the WebSocket and sends it to Deepgram.
     */
    public sendAudio(payload: string) {
        if (this.audioIn) {
            this.audioIn.write(Buffer.from(payload, "base64"));
        }
    }

    /**
     * Handles a mark event from Twilio, indicating a reply has finished playing.
     */
    public handleMark(name: string) {
        console.log(`[${this.callSid}] Received mark: ${name}`);
        // This can be used to trigger actions after a sentence is spoken.
    }

    /**
     * Stops the streaming session and cleans up resources.
     */
    public stopStreaming() {
        if (!this.callSid) return;
        console.log(`[${this.callSid}] Stopping stream...`);

        this.audioIn?.end();
        this.elevenLabsClient.close();

        this.ws = null;
        this.callSid = null;
        this.streamSid = null;
        this.audioIn = null;
        this.audioOut = null;
    }
}