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
        this.userSpeaking = false;
        this.silenceFrames = 0;
        this.framesSinceLastCommit = 0;

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
                onSessionClosed: () => console.log(`[${callSid}] [Vapi] session closed`),
            });

            console.log(`[${callSid}] Vapi session created`);

            // Trigger the welcome line by forcing an initial response turn
            this.vapiSession.commitUserAudio();
        } catch (error) {
            console.error(`[${callSid}] Failed to start Vapi session`, error);
            this.stopStreaming();
        }
    }

    public sendAudio(payload: string) {
        if (!this.vapiSession) {
            console.log(`[${this.callSid}] Vapi session is null, not sending audio`);
            return;
        }

        // Decode the base64 payload (Twilio sends audio as 8-bit mu-law at 8kHz)
        const muLawBuffer = Buffer.from(payload, "base64");

        // Convert to PCM so we can both forward the correct format to Vapi and
        // reuse the samples for the silence detector.
        const pcmBuffer = this.muLawToPcm16(muLawBuffer);

        // Vapi expects base64-encoded PCM16 audio frames.
        const pcmBase64 = pcmBuffer.toString("base64");
        this.vapiSession.sendAudioChunk(pcmBase64);

        const energy = this.computeEnergy(pcmBuffer);

        this.framesSinceLastCommit += 1;

        if (!this.userSpeaking && energy >= SPEECH_ENERGY_THRESHOLD) {
            this.userSpeaking = true;
            this.silenceFrames = 0;
            const callId = this.callSid ?? "unknown";
            console.log(
                `[${callId}] Detected user speech start (energy=${energy.toFixed(2)})`
            );
        }

        if (this.userSpeaking) {
            if (energy <= SILENCE_ENERGY_THRESHOLD) {
                this.silenceFrames += 1;
                if (this.silenceFrames >= SILENCE_FRAMES_REQUIRED) {
                    this.commitUserAudio("silence", energy);
                }
            } else {
                this.silenceFrames = 0;
            }
        }

        if (this.framesSinceLastCommit >= MAX_FRAMES_BEFORE_FORCED_COMMIT) {
            this.commitUserAudio("timeout", energy);
        }
    }

    public handleMark(mark: string) {
        console.log(`[${this.callSid}] Twilio mark received: ${mark}`);
    }

    public stopStreaming() {
        console.log(`[${this.callSid}] Stopping Vapi voice session`);
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
        this.userSpeaking = false;
        this.silenceFrames = 0;
        this.framesSinceLastCommit = 0;
    }

    private commitUserAudio(reason: "silence" | "timeout", energy: number) {
        const callId = this.callSid ?? "unknown";

        if (!this.vapiSession) {
            console.warn(
                `[${callId}] Cannot commit user audio (${reason}); Vapi session is not available`
            );
            return;
        }

        this.userSpeaking = false;
        this.silenceFrames = 0;
        this.framesSinceLastCommit = 0;

        console.log(
            `[${callId}] Committing user audio due to ${reason} (energy=${energy.toFixed(2)})`
        );

        this.vapiSession.commitUserAudio();
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

        this.ws.send(
            JSON.stringify({
                event: "media",
                streamSid: this.streamSid,
                media: { payload: audioPayload },
            })
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
                const payload = event.media?.payload;
                if (payload) {
                    this.sendAudio(payload);
                }
                break;
            }
            case "mark": {
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
