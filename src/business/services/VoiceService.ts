// src/services/VoiceService.ts

import { injectable } from "tsyringe";
import WebSocket from "ws";
import { PassThrough, Readable, Writable } from "stream";

import { DeepgramClient }   from "../../clients/DeepgramClient";
import { ChatGPTClient }    from "../../clients/ChatGPTClient";
import { ElevenLabsClient } from "../../clients/ElevenLabsClient";

@injectable()
export class VoiceService {
    constructor(
        private deepgramClient: DeepgramClient,
        private chatGptClient:  ChatGPTClient,
        private elevenClient:   ElevenLabsClient
    ) {}

    /**
     * Entry point when Twilio upgrades to /ws for a call.
     */
    public async startStreaming(ws: WebSocket, callSid: string) {
        console.log(`[${callSid}] Received start event`);

        // 1) Create a PassThrough to pipe Twilio’s audio into Deepgram
        const audioIn = new PassThrough();

        // 2) Create a Writable that turns each transcript chunk into a ChatGPT call
        const dgToGpt = new Writable({
            write: (chunk: Buffer, _encoding, callback) => {
                const transcript = chunk.toString();
                console.log(`[${callSid}] [Deepgram] Transcript:`, transcript);

                // Fire off ChatGPTClient with a one‐item Readable and a sentence callback
                this.chatGptClient
                    .start(
                        Readable.from([transcript]),
                        (sentence: string) => {
                            console.log(`[${callSid}] [ChatGPT] Sentence:`, sentence);
                            this.elevenClient.speak(sentence);
                        }
                    )
                    .catch(err =>
                        console.error(`[${callSid}] ChatGPT error:`, err)
                    );

                callback(); // signal we handled the chunk
            }
        });

        // 3) Kick off Deepgram (will write transcripts into dgToGpt)
        await this.deepgramClient.start(audioIn, dgToGpt);
        console.log(`[${callSid}] Deepgram pipeline started.`);

        // 4) Open a single ElevenLabs connection for this call
        await this.elevenClient.connect();
        console.log(`[${callSid}] ElevenLabs TTS connected.`);

        // 5) Send a welcome prompt
        this.elevenClient.speak("Hallo, hoe kan ik je helpen vandaag?");

        // 6) Feed Twilio media frames into Deepgram
        ws.on("message", (msg: string) => {
            const data = JSON.parse(msg);
            if (data.event === "media") {
                const audioBuf = Buffer.from(data.media.payload, "base64");
                audioIn.write(audioBuf);
            } else if (data.event === "stop") {
                console.log(`[${callSid}] Received stop event`);
                audioIn.end();
                this.elevenClient.close();
            }
        });

        ws.on("close", () => {
            console.log(`[${callSid}] WebSocket closed`);
            audioIn.end();
            this.elevenClient.close();
        });
    }
}
