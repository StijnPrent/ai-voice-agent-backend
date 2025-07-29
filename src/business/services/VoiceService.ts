// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import { PassThrough, Readable, Writable } from "stream";
import { DeepgramClient } from "../../clients/DeepgramClient";
import { ChatGPTClient } from "../../clients/ChatGPTClient";
import { ElevenLabsClient } from "../../clients/ElevenLabsClient";
import { CompanyService } from "./CompanyService";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../models/VoiceSettingsModel";
import { IntegrationService } from "./IntegrationService";

const USER_SILENCE_TIMEOUT_MS = 800; // Time in ms of silence before processing transcript

@injectable()
export class VoiceService {
    private ws: WebSocket | null = null;
    private callSid: string | null = null;
    private streamSid: string | null = null;
    private audioIn: PassThrough | null = null;
    private isAssistantSpeaking: boolean = false;
    private markCount: number = 0;
    private voiceSettings: VoiceSettingModel | null = null;

    // Interruption and buffering logic
    private transcriptBuffer: string = "";
    private userSpeakingTimer: NodeJS.Timeout | null = null;

    constructor(
        @inject(DeepgramClient) private deepgramClient: DeepgramClient,
        @inject(ChatGPTClient) private chatGptClient: ChatGPTClient,
        @inject(ElevenLabsClient) private elevenLabsClient: ElevenLabsClient,
        @inject(CompanyService) private companyService: CompanyService,
        @inject("IVoiceRepository") private voiceRepository: IVoiceRepository,
        @inject(IntegrationService) private integrationService: IntegrationService
    ) {}

    public async startStreaming(ws: WebSocket, callSid: string, streamSid: string, to: string) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.audioIn = new PassThrough();
        this.isAssistantSpeaking = false;
        this.markCount = 0;
        this.transcriptBuffer = "";
        if (this.userSpeakingTimer) clearTimeout(this.userSpeakingTimer);

        console.log(`[${this.callSid}] Starting stream for ${to}...`);

        const company = await this.companyService.findByTwilioNumber(to);
        this.voiceSettings = await this.voiceRepository.fetchVoiceSettings(company.id);
        const replyStyle = await this.voiceRepository.fetchReplyStyle(company.id);
        const companyInfo = await this.companyService.getCompanyInfo(company.id);
        const hasGoogleIntegration = await this.integrationService.hasCalendarConnected(company.id);

        console.log(`[${this.callSid}] Company: ${company.name}, Google Integration: ${hasGoogleIntegration}`);

        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
            console.log(`[${this.callSid}] Sent clear message to Twilio.`);
        }

        const dgToGpt = new Writable({
            write: (chunk: Buffer, _encoding, callback) => {
                const transcript = chunk.toString();
                if (transcript) {
                    console.log(`[${this.callSid}] [Deepgram] Transcript chunk:`, transcript);
                    this.handleUserSpeech(transcript);
                }
                callback();
            }
        });

        try {
            await this.deepgramClient.start(this.audioIn, dgToGpt);
            this.chatGptClient.setCompanyInfo(company, hasGoogleIntegration, replyStyle, companyInfo);
            console.log(`[${this.callSid}] Deepgram client initialized.`);
            this.speak(this.voiceSettings.welcomePhrase);
        } catch (error) {
            console.error(`[${this.callSid}] Error during service initialization:`, error);
            this.stopStreaming();
        }
    }

    private handleUserSpeech(transcript: string) {
        this.transcriptBuffer += transcript + " ";

        if (this.userSpeakingTimer) {
            clearTimeout(this.userSpeakingTimer);
        }

        this.userSpeakingTimer = setTimeout(() => {
            this.processBufferedTranscript();
        }, USER_SILENCE_TIMEOUT_MS);
    }

    private processBufferedTranscript() {
        if (!this.transcriptBuffer.trim()) {
            this.transcriptBuffer = "";
            return;
        }

        const finalTranscript = this.transcriptBuffer.trim();
        this.transcriptBuffer = "";
        console.log(`[${this.callSid}] Processing final transcript:`, finalTranscript);

        this.chatGptClient.start(
            Readable.from([finalTranscript]),
            (sentence: string) => {
                console.log(`[${this.callSid}] [ChatGPT] Sentence:`, sentence);
                this.speak(sentence);
            }
        ).catch(err => console.error(`[${this.callSid}] ChatGPT error:`, err));
    }

    private speak(text: string) {
        if (!this.voiceSettings) {
            console.error(`[${this.callSid}] Attempted to speak without voice settings.`);
            return;
        }
        
        // Stop listening for user speech while we are preparing to speak
        if (this.userSpeakingTimer) clearTimeout(this.userSpeakingTimer);
        this.transcriptBuffer = ""; // Clear buffer to prevent responding to old input

        const onStreamStart = () => {
            const markName = `spoke-${this.markCount++}`;
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: "mark",
                    streamSid: this.streamSid,
                    mark: { name: markName },
                }));
                console.log(`[${this.callSid}] Sent mark: ${markName}`);
                this.isAssistantSpeaking = true;
            }
        };

        const onAudio = (audioPayload: string) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: "media",
                    streamSid: this.streamSid,
                    media: { payload: audioPayload },
                }));
            }
        };

        const onClose = () => {
            // This will be called when the stream ends naturally or is stopped.
            this.isAssistantSpeaking = false;
        };

        this.elevenLabsClient.speak(text, this.voiceSettings, onStreamStart, onAudio, onClose);
    }

    public sendAudio(payload: string) {
        if (this.isAssistantSpeaking) {
            console.log(`[${this.callSid}] User interruption detected.`);
            this.elevenLabsClient.stop(); // Stop the AI from speaking
            this.isAssistantSpeaking = false; // Allow user to speak
        }

        if (this.audioIn) {
            this.audioIn.write(Buffer.from(payload, "base64"));
        }
    }

    public handleMark(name: string) {
        console.log(`[${this.callSid}] Received mark: ${name}. Assistant finished a sentence.`);
        // This confirms a segment of speech has been fully sent to Twilio.
        // The isAssistantSpeaking flag is now primarily managed by onClose of the ElevenLabs stream.
    }

    public stopStreaming() {
        if (!this.callSid) return;
        console.log(`[${this.callSid}] Stopping stream...`);
        this.elevenLabsClient.stop();
        if (this.userSpeakingTimer) clearTimeout(this.userSpeakingTimer);
        this.audioIn?.end();
        this.ws = null;
        this.callSid = null;
        this.streamSid = null;
        this.audioIn = null;
        this.voiceSettings = null;
        this.transcriptBuffer = "";
    }
}

