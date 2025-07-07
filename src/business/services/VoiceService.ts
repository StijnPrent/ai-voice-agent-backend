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
    private isAssistantSpeaking: boolean = false;
    private markCount: number = 0;

    constructor(
        @inject(DeepgramClient) private deepgramClient: DeepgramClient,
        @inject(ChatGPTClient) private chatGptClient: ChatGPTClient,
        @inject(ElevenLabsClient) private elevenLabsClient: ElevenLabsClient
    ) {}

    public async startStreaming(ws: WebSocket, callSid: string, streamSid: string) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.audioIn = new PassThrough();
        this.audioOut = new PassThrough();
        this.isAssistantSpeaking = false;
        this.markCount = 0;

        console.log(`[${this.callSid}] Starting stream with turn-taking logic...`);

        // 1. Pipe audio from our output stream directly to the Twilio WebSocket
        this.audioOut.on('data', (chunk) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: "media",
                    streamSid: this.streamSid,
                    media: { payload: chunk.toString("base64") },
                }));
            }
        });

        // 2. Set up the pipeline from Deepgram to ChatGPT
        const dgToGpt = new Writable({
            write: (chunk: Buffer, _encoding, callback) => {
                const transcript = chunk.toString();
                if (transcript) {
                    console.log(`[${this.callSid}] [Deepgram] Transcript:`, transcript);
                    this.handleUserResponse(transcript);
                }
                callback();
            }
        });

        try {
            // 3. Start the clients
            await this.deepgramClient.start(this.audioIn, dgToGpt);
            this.elevenLabsClient.connect(this.audioOut); // This just initializes the client now
            console.log(`[${this.callSid}] All clients initialized.`);

            // 4. Send the welcome message
            this.speak("Hello, how can I help you today?");

        } catch (error) {
            console.error(`[${this.callSid}] Error during service initialization:`, error);
            this.stopStreaming();
        }
    }

    private handleUserResponse(transcript: string) {
        this.chatGptClient.start(
            Readable.from([transcript]),
            (sentence: string) => {
                console.log(`[${this.callSid}] [ChatGPT] Sentence:`, sentence);
                this.speak(sentence);
            }
        ).catch(err => console.error(`[${this.callSid}] ChatGPT error:`, err));
    }

    private speak(text: string) {
        this.isAssistantSpeaking = true;
        this.elevenLabsClient.speak(text);

        // After sending the text to TTS, send a mark to Twilio to know when it's done playing.
        const markName = `spoke-${this.markCount++}`;
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                event: "mark",
                streamSid: this.streamSid,
                mark: { name: markName },
            }));
            console.log(`[${this.callSid}] Sent mark: ${markName}`);
        }
    }

    public sendAudio(payload: string) {
        // Only process user audio if the assistant is not speaking.
        if (this.audioIn && !this.isAssistantSpeaking) {
            this.audioIn.write(Buffer.from(payload, "base64"));
        }
    }

    public handleMark(name: string) {
        console.log(`[${this.callSid}] Received mark: ${name}. User can now speak.`);
        // The assistant has finished speaking, so we set the flag to false.
        this.isAssistantSpeaking = false;
    }

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
