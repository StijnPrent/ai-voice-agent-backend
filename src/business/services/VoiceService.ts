// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import { VapiClient, VapiRealtimeSession } from "../../clients/VapiClient";
import { CompanyService } from "./CompanyService";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../models/VoiceSettingsModel";
import { IntegrationService } from "./IntegrationService";
import { SchedulingService } from "./SchedulingService";

const ENERGY_THRESHOLD = 180;
const SILENCE_FRAMES_REQUIRED = 8;

@injectable()
export class VoiceService {
    private ws: WebSocket | null = null;
    private callSid: string | null = null;
    private streamSid: string | null = null;
    private voiceSettings: VoiceSettingModel | null = null;
    private vapiSession: VapiRealtimeSession | null = null;

    private assistantSpeaking = false;
    private userSpeaking = false;
    private silenceFrames = 0;

    constructor(
        @inject(VapiClient) private readonly vapiClient: VapiClient,
        @inject(CompanyService) private readonly companyService: CompanyService,
        @inject("IVoiceRepository") private readonly voiceRepository: IVoiceRepository,
        @inject(IntegrationService) private readonly integrationService: IntegrationService,
        @inject(SchedulingService) private readonly schedulingService: SchedulingService
    ) {}

    public async startStreaming(ws: WebSocket, callSid: string, streamSid: string, to: string) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.assistantSpeaking = false;
        this.userSpeaking = false;
        this.silenceFrames = 0;

        console.log(`[${callSid}] Starting Vapi-powered voice session for ${to}`);

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

            // Trigger the welcome line by forcing an initial response turn
            this.vapiSession.commitUserAudio();
        } catch (error) {
            console.error(`[${callSid}] Failed to start Vapi session`, error);
            this.stopStreaming();
        }
    }

    public sendAudio(payload: string) {
        if (!this.vapiSession) {
            return;
        }

        this.vapiSession.sendAudioChunk(payload);

        const buffer = Buffer.from(payload, "base64");
        const energy = this.computeEnergy(buffer);

        if (energy > ENERGY_THRESHOLD) {
            this.userSpeaking = true;
            this.silenceFrames = 0;
        } else if (this.userSpeaking) {
            this.silenceFrames += 1;
            if (this.silenceFrames >= SILENCE_FRAMES_REQUIRED) {
                this.userSpeaking = false;
                this.silenceFrames = 0;
                this.vapiSession.commitUserAudio();
            }
        }
    }

    public handleMark(mark: string) {
        console.log(`[${this.callSid}] Twilio mark received: ${mark}`);
    }

    public stopStreaming() {
        console.log(`[${this.callSid}] Stopping Vapi voice session`);
        try {
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

    private computeEnergy(buf: Buffer): number {
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
            const sample = buf[i] - 128;
            sum += sample * sample;
        }
        return Math.sqrt(sum / buf.length);
    }
}
