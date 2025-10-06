// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import { VapiClient, VapiRealtimeSession } from "../../clients/VapiClient";
import { CompanyService } from "./CompanyService";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../models/VoiceSettingsModel";
import { IntegrationService } from "./IntegrationService";
import { SchedulingService } from "./SchedulingService";

const SPEECH_ENERGY_THRESHOLD = 325;
const SILENCE_ENERGY_THRESHOLD = 175;
const SILENCE_FRAMES_REQUIRED = 20;
const MAX_FRAMES_BEFORE_FORCED_COMMIT = 400;
const MIN_ACTIVE_SPEECH_FRAMES_FOR_COMMIT = 12;
const MIN_AVERAGE_SPEECH_ENERGY_FOR_COMMIT = 225;

@injectable()
export class VoiceService {
    private ws: WebSocket | null = null;
    private callSid: string | null = null;
    private streamSid: string | null = null;
    private voiceSettings: VoiceSettingModel | null = null;
    private vapiSession: VapiRealtimeSession | null = null;
    private readonly handleTwilioStreamMessage = (rawMessage: WebSocket.RawData) => {
        let messageString: string;

        if (typeof rawMessage === "string") {
            messageString = rawMessage;
        } else if (Buffer.isBuffer(rawMessage)) {
            messageString = rawMessage.toString("utf8");
        } else if (Array.isArray(rawMessage)) {
            messageString = Buffer.concat(rawMessage).toString("utf8");
        } else if (rawMessage instanceof ArrayBuffer) {
            messageString = Buffer.from(rawMessage).toString("utf8");
        } else {
            messageString = String(rawMessage);
        }

        const trimmedMessage = messageString.trim();
        if (!trimmedMessage) {
            return;
        }

        this.twilioMessagesReceived += 1;
        if (
            this.twilioMessagesReceived <= 5 ||
            this.twilioMessagesReceived % 100 === 0
        ) {
            console.log(
                `[${this.callSid ?? "unknown"}] Twilio message #${this.twilioMessagesReceived} received`
            );
        }

        let parsed: TwilioMediaStreamEvent;
        try {
            parsed = JSON.parse(trimmedMessage);
        } catch (error) {
            console.error(`[${this.callSid ?? "unknown"}] Failed to parse Twilio stream message`, error);
            return;
        }

        this.handleTwilioStreamEvent(parsed);
    };

    private assistantSpeaking = false;
    private userSpeaking = false;
    private silenceFrames = 0;
    private framesSinceLastCommit = 0;
    private activeSpeechFrames = 0;
    private cumulativeSpeechEnergy = 0;
    private lastUserEnergy = 0;

    private twilioMessagesReceived = 0;
    private twilioMediaEvents = 0;
    private twilioMarksReceived = 0;
    private totalAudioChunksForwardedToVapi = 0;
    private totalMuLawBytesForwardedToVapi = 0;
    private totalAssistantAudioChunks = 0;

    constructor(
        @inject(VapiClient) private readonly vapiClient: VapiClient,
        @inject(CompanyService) private readonly companyService: CompanyService,
        @inject("IVoiceRepository") private readonly voiceRepository: IVoiceRepository,
        @inject(IntegrationService) private readonly integrationService: IntegrationService,
        @inject(SchedulingService) private readonly schedulingService: SchedulingService
    ) {}

    public async startStreaming(
        ws: WebSocket,
        callSid: string,
        streamSid: string,
        to: string,
        initialEvent?: TwilioMediaStreamEvent
    ) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.assistantSpeaking = false;
        this.resetSpeechTracking();
        this.twilioMessagesReceived = 0;
        this.twilioMediaEvents = 0;
        this.twilioMarksReceived = 0;
        this.totalAudioChunksForwardedToVapi = 0;
        this.totalMuLawBytesForwardedToVapi = 0;
        this.totalAssistantAudioChunks = 0;

        console.log(`[${callSid}] Starting Vapi-powered voice session for ${to}`);

        ws.on("message", this.handleTwilioStreamMessage);
        ws.on("error", (error) => {
            console.error(`[${callSid}] Twilio stream websocket error`, error);
        });

        ws.on("close", (code, reason) => {
            const rawReason = Buffer.isBuffer(reason)
                ? reason.toString("utf8")
                : typeof reason === "string"
                    ? reason
                    : "";
            const reasonText = rawReason.trim();
            const formattedReason = reasonText ? ` (${reasonText})` : "";
            console.log(`[${callSid}] Twilio stream websocket closed with code ${code}${formattedReason}`);
        });

        if (initialEvent) {
            this.handleTwilioStreamEvent(initialEvent);
        }

        try {
            const company = await this.companyService.findByTwilioNumber(to);
            this.voiceSettings = await this.voiceRepository.fetchVoiceSettings(company.id);
            const replyStyle = await this.voiceRepository.fetchReplyStyle(company.id);
            const companyContext = await this.companyService.getCompanyContext(company.id);
            const schedulingContext = await this.schedulingService.getSchedulingContext(company.id);
            const hasGoogleIntegration = await this.integrationService.hasCalendarConnected(company.id);

            this.vapiClient.setCompanyInfo(
                company,
                hasGoogleIntegration,
                replyStyle,
                companyContext,
                schedulingContext,
                this.voiceSettings
            );

            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
            }

            this.vapiSession = await this.vapiClient.openRealtimeSession(callSid, {
                onAudio: (audioPayload) => this.forwardAudioToTwilio(audioPayload),
                onText: (text) => console.log(`[${callSid}] [Vapi] text:`, text),
                onToolStatus: (status) => {
                    console.log(`[${callSid}] [Vapi] tool status: ${status}`);
                    if (status === "response-completed") {
                        this.assistantSpeaking = false;
                    }
                },
                onSessionError: (err) => console.error(`[${callSid}] [Vapi] session error`, err),
                onSessionClosed: () => {
                    console.log(`[${callSid}] [Vapi] session closed`);
                    this.logSessionSnapshot("vapi session closed");
                },
            });

            console.log(`[${callSid}] Vapi session created`);
            this.logSessionSnapshot("vapi session created");

            // Trigger the welcome line by forcing an initial response turn
            this.vapiSession.commitUserAudio();
        } catch (error) {
            console.error(`[${callSid}] Failed to start Vapi session`, error);
            this.stopStreaming();
        }
    }

    public sendAudio(payload: string) {
        const callId = this.callSid ?? "unknown";

        if (!this.vapiSession) {
            console.log(`[${callId}] Vapi session is null, not sending audio`);
            return;
        }

        // Decode the base64 payload (Twilio sends audio as 8-bit mu-law at 8kHz)
        const muLawBuffer = Buffer.from(payload, "base64");

        // Forward the original mu-law audio bytes directly to Vapi.
        this.vapiSession.sendAudioChunkBinary(muLawBuffer);

        this.totalAudioChunksForwardedToVapi += 1;
        this.totalMuLawBytesForwardedToVapi += muLawBuffer.length;

        // Convert to PCM so we can reuse the samples for silence detection and
        // energy tracking without mutating the forwarded payload.
        const pcmBuffer = this.muLawToPcm16(muLawBuffer);

        const energy = this.computeEnergy(pcmBuffer);
        this.lastUserEnergy = energy;

        if (
            this.totalAudioChunksForwardedToVapi <= 3 ||
            this.totalAudioChunksForwardedToVapi % 50 === 0
        ) {
            console.log(
                `[${callId}] Forwarded audio chunk #${this.totalAudioChunksForwardedToVapi} to Vapi (muLawBytes=${muLawBuffer.length}, energy=${energy.toFixed(2)})`
            );
        }

        if (!this.userSpeaking && energy >= SPEECH_ENERGY_THRESHOLD) {
            this.userSpeaking = true;
            this.silenceFrames = 0;
            this.framesSinceLastCommit = 0;
            this.activeSpeechFrames = 0;
            this.cumulativeSpeechEnergy = 0;
            const callId = this.callSid ?? "unknown";
            console.log(
                `[${callId}] Detected user speech start (energy=${energy.toFixed(2)})`
            );
        }

        if (this.userSpeaking) {
            this.framesSinceLastCommit += 1;
            if (energy <= SILENCE_ENERGY_THRESHOLD) {
                this.silenceFrames += 1;
                if (this.silenceFrames >= SILENCE_FRAMES_REQUIRED) {
                    this.finalizeUserSpeechSegment("silence", energy);
                }
            } else {
                this.silenceFrames = 0;
                this.activeSpeechFrames += 1;
                this.cumulativeSpeechEnergy += energy;
            }
            if (this.framesSinceLastCommit >= MAX_FRAMES_BEFORE_FORCED_COMMIT) {
                this.finalizeUserSpeechSegment("timeout", energy);
            }
        } else {
            this.framesSinceLastCommit = 0;
        }
    }

    public handleMark(mark: string) {
        console.log(`[${this.callSid}] Twilio mark received: ${mark}`);
    }

    public stopStreaming() {
        const callId = this.callSid ?? "unknown";
        console.log(`[${callId}] Stopping Vapi voice session`);
        this.logSessionSnapshot("twilio stop");
        try {
            if (this.ws) {
                this.ws.removeListener("message", this.handleTwilioStreamMessage);
            }
            this.vapiSession?.close();
        } catch (error) {
            console.error("[VoiceService] Failed to close Vapi session", error);
        }
        this.vapiSession = null;
        this.ws = null;
        this.callSid = null;
        this.streamSid = null;
        this.voiceSettings = null;
        this.assistantSpeaking = false;
        this.resetSpeechTracking();
    }

    private finalizeUserSpeechSegment(
        reason: "silence" | "timeout",
        trailingEnergy: number
    ) {
        if (!this.userSpeaking) {
            return;
        }

        const callId = this.callSid ?? "unknown";
        const frames = this.activeSpeechFrames;
        const averageEnergy = frames > 0 ? this.cumulativeSpeechEnergy / frames : 0;

        console.log(
            `[${callId}] Evaluating user audio segment due to ${reason} (${this.formatSegmentDebugInfo(frames, averageEnergy)})`
        );
        if (
            frames < MIN_ACTIVE_SPEECH_FRAMES_FOR_COMMIT ||
            averageEnergy < MIN_AVERAGE_SPEECH_ENERGY_FOR_COMMIT
        ) {
            console.log(
                `[${callId}] Skipping user audio commit due to ${reason}; insufficient speech captured (${this.formatSegmentDebugInfo(frames, averageEnergy)})`
            );
            this.resetSpeechTracking();
            return;
        }

        this.commitUserAudio(reason, trailingEnergy, frames, averageEnergy);
    }

    private commitUserAudio(
        reason: "silence" | "timeout",
        energy: number,
        frames: number,
        averageEnergy: number
    ) {
        const callId = this.callSid ?? "unknown";

        if (!this.vapiSession) {
            console.warn(
                `[${callId}] Cannot commit user audio (${reason}); Vapi session is not available`
            );
            return;
        }

        console.log(
            `[${callId}] Committing user audio due to ${reason} (energy=${energy.toFixed(2)}). Segment stats: ${this.formatSegmentDebugInfo(frames, averageEnergy)}`
        );

        this.vapiSession.commitUserAudio();
        this.logSessionSnapshot(`user commit (${reason})`);
        this.resetSpeechTracking();
    }

    private resetSpeechTracking() {
        this.userSpeaking = false;
        this.silenceFrames = 0;
        this.framesSinceLastCommit = 0;
        this.activeSpeechFrames = 0;
        this.cumulativeSpeechEnergy = 0;
        this.lastUserEnergy = 0;
    }

    private forwardAudioToTwilio(audioPayload: string) {
        if (this.ws?.readyState !== WebSocket.OPEN || !this.streamSid) return;

        if (!this.assistantSpeaking) {
            this.assistantSpeaking = true;
            const markName = `vapi-${Date.now()}`;
            this.ws.send(
                JSON.stringify({
                    event: "mark",
                    streamSid: this.streamSid,
                    mark: { name: markName },
                })
            );
        }

        this.totalAssistantAudioChunks += 1;
        const callId = this.callSid ?? "unknown";
        if (this.totalAssistantAudioChunks <= 3 || this.totalAssistantAudioChunks % 50 === 0) {
            console.log(
                `[${callId}] Forwarding assistant audio chunk #${this.totalAssistantAudioChunks} to Twilio (payloadBytes=${Buffer.from(audioPayload, "base64").length})`
            );
        }

        this.ws.send(
            JSON.stringify({
                event: "media",
                streamSid: this.streamSid,
                media: { payload: audioPayload },
            })
        );
    }

    private formatSegmentDebugInfo(frames: number, averageEnergy: number): string {
        const parts = [
            `frames=${frames}`,
            `avgEnergy=${averageEnergy.toFixed(2)}`,
            `framesSinceLastCommit=${this.framesSinceLastCommit}`,
            `silenceFrames=${this.silenceFrames}`,
            `lastUserEnergy=${this.lastUserEnergy.toFixed(2)}`,
            `chunksToVapi=${this.totalAudioChunksForwardedToVapi}`,
        ];

        return parts.join(", ");
    }

    private logSessionSnapshot(context: string) {
        const callId = this.callSid ?? "unknown";
        console.log(
            `[${callId}] Session snapshot (${context}): twilioMessages=${this.twilioMessagesReceived}, mediaEvents=${this.twilioMediaEvents}, marks=${this.twilioMarksReceived}, chunksToVapi=${this.totalAudioChunksForwardedToVapi}, muLawBytesToVapi=${this.totalMuLawBytesForwardedToVapi}, assistantChunks=${this.totalAssistantAudioChunks}, userSpeaking=${this.userSpeaking}, assistantSpeaking=${this.assistantSpeaking}`
        );
    }

    private muLawToPcm16(muLawBuffer: Buffer): Buffer {
        const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);

        for (let i = 0; i < muLawBuffer.length; i++) {
            const decoded = this.decodeMuLawSample(muLawBuffer[i]);
            pcmBuffer.writeInt16LE(decoded, i * 2);
        }

        return pcmBuffer;
    }

    private decodeMuLawSample(muLawByte: number): number {
        // Invert all bits
        const value = ~muLawByte & 0xff;

        const sign = value & 0x80 ? -1 : 1;
        const exponent = (value >> 4) & 0x07;
        const mantissa = value & 0x0f;

        // Reconstruct the magnitude (see ITU-T G.711 spec)
        let magnitude = ((mantissa << 3) + 0x84) << exponent;
        magnitude -= 0x84;

        return sign * magnitude;
    }

    private computeEnergy(buf: Buffer): number {
        if (buf.length === 0) return 0;

        let sum = 0;
        const samples = buf.length / 2;
        for (let i = 0; i < samples; i++) {
            const sample = buf.readInt16LE(i * 2);
            sum += sample * sample;
        }

        return Math.sqrt(sum / samples);
    }

    private handleTwilioStreamEvent(event: TwilioMediaStreamEvent) {
        switch (event.event) {
            case "start": {
                if (event.start?.callSid) {
                    this.callSid = event.start.callSid;
                }
                if (event.start?.streamSid) {
                    this.streamSid = event.start.streamSid;
                }
                const callId = this.callSid ?? "unknown";
                console.log(
                    `[${callId}] Twilio media stream started${
                        this.streamSid ? ` (streamSid ${this.streamSid})` : ""
                    }`
                );
                break;
            }
            case "media": {
                this.twilioMediaEvents += 1;
                const payload = event.media?.payload;
                if (payload) {
                    this.sendAudio(payload);
                } else {
                    console.warn(`[${this.callSid ?? "unknown"}] Twilio media event missing payload`);
                }
                break;
            }
            case "mark": {
                this.twilioMarksReceived += 1;
                const markName = event.mark?.name;
                if (markName) {
                    this.handleMark(markName);
                }
                break;
            }
            case "stop": {
                this.stopStreaming();
                break;
            }
            case "keepalive":
            case "connected":
                // Ignore keepalive/connection acknowledgements.
                break;
            default: {
                console.log(`[${this.callSid ?? "unknown"}] Ignoring unhandled Twilio event type: ${event.event}`);
            }
        }
    }
}

type TwilioMediaStreamEvent = {
    event: string;
    start?: {
        callSid?: string;
        streamSid?: string;
    };
    media?: {
        payload?: string;
    };
    mark?: {
        name?: string;
    };
    stop?: {
        callSid?: string;
    };
};
