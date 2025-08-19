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
import { ElevenPhraseStreamer } from "../../utils/tts/ElevenPhraseStreamer";
import { SchedulingService } from "./SchedulingService";

const USER_SILENCE_TIMEOUT_MS = 0; // Time in ms of silence before processing transcript
const TTS_END_DEBOUNCE_MS = 1800;      // End ElevenLabs stream shortly after last delta

// "Uhm" pre-roll config
const PREFILL_DELAY_MS = 350;         // wait this long before inserting a filler
const PREFILL_PROBABILITY = 0.15;     // 15% of turns get a filler
const PREFILL_CHOICES = ["Ehm… ", "Even kijken… ", "Hmm… "];

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

    // TTS streaming helpers
    private phraseStreamer: ElevenPhraseStreamer | null = null;
    private ttsEndTimer: NodeJS.Timeout | null = null;
    private ttsOpen = false;

    // "Uhm" pre-roll state
    private prefillTimer: NodeJS.Timeout | null = null;
    private llmStarted = false;
    private prefilled = false;

    private ttsState: "idle" | "opening" | "open" = "idle";
    private earlyLLMBuffer: string[] = [];

    constructor(
        @inject(DeepgramClient) private deepgramClient: DeepgramClient,
        @inject(ChatGPTClient) private chatGptClient: ChatGPTClient,
        @inject(ElevenLabsClient) private elevenLabsClient: ElevenLabsClient,
        @inject(CompanyService) private companyService: CompanyService,
        @inject("IVoiceRepository") private voiceRepository: IVoiceRepository,
        @inject(IntegrationService) private integrationService: IntegrationService,
        @inject(SchedulingService) private schedulingService: SchedulingService
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
        const companyContext = await this.companyService.getCompanyContext(company.id);
        const schedulingContext = await this.schedulingService.getSchedulingContext(company.id);
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

                    // If we get a transcript while the assistant is speaking, it's a confirmed interruption.
                    if (this.isAssistantSpeaking) {
                        console.log(`[${this.callSid}] User interruption detected.`);
                        this.stopTTSTurn(); // stop ElevenLabs immediately
                    }

                    this.handleUserSpeech(transcript);
                }
                callback();
            }
        });

        try {
            await this.deepgramClient.start(this.audioIn, dgToGpt);
            this.chatGptClient.setCompanyInfo(company, hasGoogleIntegration, replyStyle, companyContext, schedulingContext);
            console.log(`[${this.callSid}] Deepgram client initialized.`);

            // One-shot welcome phrase (kept as before)
            console.log("[VoiceService] speak() starting welcome");
            await this.speak(this.voiceSettings.welcomePhrase);
            console.log("[VoiceService] speak() finished welcome");
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

    private async processBufferedTranscript() {
        if (!this.transcriptBuffer.trim()) {
            this.transcriptBuffer = "";
            return;
        }

        const finalTranscript = this.transcriptBuffer.trim();
        this.transcriptBuffer = "";
        console.log(`[${this.callSid}] Processing final transcript:`, finalTranscript);

        this.clearPrefill();
        this.llmStarted = false;
        this.prefilled = false;

        this.beginTTSTurn();
        this.schedulePrefillFiller(finalTranscript);

        // --- Start of new logging ---
        console.log(`[${this.callSid}] Calling chatGptClient.start...`);

        await this.chatGptClient.start(
            Readable.from([finalTranscript]),
            async (delta: string) => {
                console.log(`[${this.callSid}] [ChatGPT] Received delta: "${delta}"`); // <-- ADD THIS
                if (!this.llmStarted) {
                    this.llmStarted = true;
                    this.clearPrefill();
                }
                this.onLLMDelta(delta);
            }
        ).catch(err => console.error(`[${this.callSid}] ChatGPT error:`, err));

        console.log(`[${this.callSid}] Awaited chatGptClient.start has finished.`); // <-- AND THIS
        // --- End of new logging ---

        this.scheduleTTSEnd();
    }

    // ---- "Uhm" pre-roll helpers ----
    private schedulePrefillFiller(userText: string) {
        if (!this.shouldPrefillFiller(userText)) return;
        if (this.prefillTimer) clearTimeout(this.prefillTimer);

        this.prefillTimer = setTimeout(() => {
            if (this.llmStarted) return; // model already talking

            if (this.ttsState === "idle") this.beginTTSTurn();
            const filler = this.pickFiller();

            // If not fully open yet, buffer the filler; otherwise push it immediately
            if (this.ttsState !== "open" || !this.phraseStreamer) {
                this.earlyLLMBuffer.push(filler);
            } else {
                this.phraseStreamer.push(filler);
                this.scheduleTTSEnd();
            }
            this.prefilled = true;
        }, PREFILL_DELAY_MS);
    }

    private shouldPrefillFiller(userText: string): boolean {
        // Keep it simple: random chance, avoid after simple yes/no starts
        if (Math.random() >= PREFILL_PROBABILITY) return false;
        if (/^\s*(ja|nee)\b/i.test(userText)) return false;
        return true;
    }

    private pickFiller(): string {
        const i = Math.floor(Math.random() * PREFILL_CHOICES.length);
        return PREFILL_CHOICES[i];
    }

    private clearPrefill() {
        if (this.prefillTimer) { clearTimeout(this.prefillTimer); this.prefillTimer = null; }
    }
    // ---- End pre-roll helpers ----

    // ---- ElevenLabs streaming orchestration ----
    private beginTTSTurn() {
        if (!this.voiceSettings) {
            console.error(`[${this.callSid}] Attempted to open TTS without voice settings.`);
            return;
        }
        if (this.ttsState !== "idle") return; // ← prevent re-entrant opens
        this.ttsState = "opening";

        const onStreamStart = () => {
            this.isAssistantSpeaking = true;
            const markName = `spoke-${this.markCount++}`;
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: "mark",
                    streamSid: this.streamSid,
                    mark: { name: markName },
                }));
                console.log(`[${this.callSid}] Sent mark: ${markName}`);
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
            this.isAssistantSpeaking = false;
            this.phraseStreamer = null;
            if (this.ttsEndTimer) { clearTimeout(this.ttsEndTimer); this.ttsEndTimer = null; }
            this.clearPrefill();
            this.ttsState = "idle";
        };

        this.elevenLabsClient.beginStream(
            this.voiceSettings,
            onStreamStart,
            onAudio,
            onClose,
            () => {
                // onReady
                // Create the chunker only once TTS is ready
                console.log(`[${this.callSid}] TTS onReady (stream open)`);
                this.phraseStreamer = new ElevenPhraseStreamer((text) => this.elevenLabsClient.sendText(text));
                this.ttsState = "open";

                // Drain anything that arrived while opening
                if (this.earlyLLMBuffer.length) {
                    const buffered = this.earlyLLMBuffer.join("");
                    this.earlyLLMBuffer = [];
                    this.phraseStreamer.push(buffered);
                    this.scheduleTTSEnd();
                }
            }
        );
    }

    private onLLMDelta(delta: string) {
        console.log(`[${this.callSid}] onLLMDelta len=${delta.length} state=${this.ttsState}`);
        if (!delta) return;

        if (this.ttsState === "idle") {
            this.beginTTSTurn();              // start a new turn
            this.earlyLLMBuffer.push(delta);  // buffer until open
            return;
        }
        if (this.ttsState === "opening" || !this.phraseStreamer) {
            this.earlyLLMBuffer.push(delta);  // still opening: buffer
            return;
        }

        // state === "open"
        this.phraseStreamer.push(delta);
        this.scheduleTTSEnd();
    }


    private scheduleTTSEnd() {
        if (this.ttsEndTimer) clearTimeout(this.ttsEndTimer);
        this.ttsEndTimer = setTimeout(() => this.endTTSTurn(), TTS_END_DEBOUNCE_MS);
    }

    private endTTSTurn() {
        if (this.ttsState !== "open") return;
        try {
            this.phraseStreamer?.end();
            this.elevenLabsClient.endStream();
        } finally {
            this.phraseStreamer = null;
            this.isAssistantSpeaking = false;
            this.ttsState = "idle";
            if (this.ttsEndTimer) { clearTimeout(this.ttsEndTimer); this.ttsEndTimer = null; }
            this.clearPrefill();
        }
    }

    private stopTTSTurn() {
        try { this.elevenLabsClient.stop(); } catch {}
        this.phraseStreamer = null;
        this.isAssistantSpeaking = false;
        this.ttsState = "idle";
        if (this.ttsEndTimer) { clearTimeout(this.ttsEndTimer); this.ttsEndTimer = null; }
        this.clearPrefill();
    }
    // ---- End ElevenLabs streaming orchestration ----

    // Kept for one-shot phrases like the welcome line
    private async speak(text: string) {
        if (!this.voiceSettings) {
            console.error(`[${this.callSid}] Attempted to speak without voice settings.`);
            return;
        }

        if (this.userSpeakingTimer) clearTimeout(this.userSpeakingTimer);
        this.transcriptBuffer = "";

        const onStreamStart = () => {
            console.log("[TW] onStreamStart");
            this.isAssistantSpeaking = true;
            const markName = `spoke-${this.markCount++}`;
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: "mark",
                    streamSid: this.streamSid,
                    mark: { name: markName },
                }));
                console.log(`[${this.callSid}] Sent mark: ${markName}`);
            }
        };

        const onAudio = (audioPayload: string) => {
            console.log("[TW] write", { bytes: audioPayload.length });
            console.log(audioPayload)
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: "media",
                    streamSid: this.streamSid,
                    media: { payload: audioPayload },
                }));
            }
        };

        const onClose = () => {
            console.log("[TW] onClose");
            this.isAssistantSpeaking = false;
        };

        this.elevenLabsClient.speak(text, this.voiceSettings, onStreamStart, onAudio, onClose);
    }

    public sendAudio(payload: string) {
        if (this.audioIn) {
            this.audioIn.write(Buffer.from(payload, "base64"));
        }
    }

    public handleMark(name: string) {
        console.log(`[${this.callSid}] Received mark: ${name}. Assistant finished a sentence.`);
    }

    public stopStreaming() {
        if (!this.callSid) return;
        console.log(`[${this.callSid}] Stopping stream...`);
        this.stopTTSTurn();
        if (this.userSpeakingTimer) clearTimeout(this.userSpeakingTimer);
        this.audioIn?.end();
        this.chatGptClient.clearHistory();
        this.ws = null;
        this.callSid = null;
        this.streamSid = null;
        this.audioIn = null;
        this.voiceSettings = null;
        this.transcriptBuffer = "";
    }
}
