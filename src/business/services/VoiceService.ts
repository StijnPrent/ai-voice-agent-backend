// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import WebSocket from "ws";
import { VapiClient, VapiRealtimeSession } from "../../clients/VapiClient";
import { CompanyService } from "./CompanyService";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../models/VoiceSettingsModel";
import { IntegrationService } from "./IntegrationService";
import { SchedulingService } from "./SchedulingService";

const ENERGY_THRESHOLD = 100;
const SILENCE_FRAMES_REQUIRED = 25;

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

        ws.on("message", (data, isBinary) => {
            try {
                if (isBinary) return; // Twilio sends JSON text frames

                const s = typeof data === "string" ? data : data.toString("utf8");
                if (!s.trim().startsWith("{")) return; // ignore noise/keepalives

                const msg = JSON.parse(s);
                const ev = msg.event;

                switch (ev) {
                    case "start": {
                        // Twilio will include its streamSid here too — keep it in sync
                        const sid = msg.start?.streamSid || msg.streamSid;
                        if (sid) this.streamSid = sid;
                        console.log(`[${this.callSid}] Twilio stream started (streamSid=${this.streamSid})`);
                        break;
                    }

                    case "media": {
                        const payload = msg.media?.payload;
                        if (payload && typeof payload === "string") {
                            // Forward original 8k μ-law base64 to Vapi
                            this.sendAudio(payload);
                        }
                        break;
                    }

                    case "mark": {
                        const name = msg.mark?.name || "";
                        this.handleMark(name);
                        break;
                    }

                    case "stop": {
                        console.log(`[${this.callSid}] Twilio stream STOP received`);
                        this.stopStreaming();
                        break;
                    }

                  // Optional: DTMF, etc.
                    case "dtmf":
                    case "clear": {
                        break;
                    }

                    default: {
                        // Some Twilio keepalives show up as {"event":"..."} — safe to ignore
                        // console.debug(`[${this.callSid}] Twilio event ${ev}`);
                        break;
                    }
                }
            } catch (err) {
                console.error(`[${this.callSid}] Failed to handle Twilio message`, err);
            }
        });

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

        // Forward the original mu-law audio payload to Vapi. The realtime session
        // is configured for `mulaw` in `VapiClient.createWebsocketCall`, so the
        // payload must remain in that format.
        this.vapiSession.sendAudioChunk(payload);

        // Convert to PCM only for energy analysis used in the silence detector.
        const pcmBuffer = this.muLawToPcm16(muLawBuffer);

        const energy = this.computeEnergy(pcmBuffer);

        if (energy > ENERGY_THRESHOLD) {
            this.userSpeaking = true;
            this.silenceFrames = 0;
        } else if (this.userSpeaking) {
            this.silenceFrames += 1;
            if (this.silenceFrames >= SILENCE_FRAMES_REQUIRED) {
                this.userSpeaking = false;
                this.silenceFrames = 0;
                console.log(`[${this.callSid}] Committing user audio`);
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
}
