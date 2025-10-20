// src/business/services/VoiceService.ts
import { inject, injectable } from "tsyringe";
import type { VoiceSessionManager } from "./VoiceSessionManager";
import WebSocket from "ws";
import { VapiClient, VapiRealtimeSession } from "../../clients/VapiClient";
import { CompanyService } from "./CompanyService";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../models/VoiceSettingsModel";
import { IntegrationService } from "./IntegrationService";
import { SchedulingService } from "./SchedulingService";
import { UsageService } from "./UsageService";
import { CallLogService } from "./CallLogService";
import { TwilioClient } from "../../clients/TwilioClient";

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
    private vapiCallId: string | null = null;
    private callStartedAt: Date | null = null;
    private activeCompanyId: bigint | null = null;
    private callerNumber: string | null = null;
    private companyTwilioNumber: string | null = null;
    private companyTransferNumber: string | null = null;
    private usageRecorded = false;
    private sessionManager: VoiceSessionManager | null = null;
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
    private stopping = false;

    constructor(
        @inject(VapiClient) private readonly vapiClient: VapiClient,
        @inject(CompanyService) private readonly companyService: CompanyService,
        @inject("IVoiceRepository") private readonly voiceRepository: IVoiceRepository,
        @inject(IntegrationService) private readonly integrationService: IntegrationService,
        @inject(SchedulingService) private readonly schedulingService: SchedulingService,
        @inject(UsageService) private readonly usageService: UsageService,
        @inject(CallLogService) private readonly callLogService: CallLogService,
        @inject("TwilioClient") private readonly twilioClient: TwilioClient
    ) {}

    public bindSessionManager(sessionManager: VoiceSessionManager) {
        this.sessionManager = sessionManager;
    }

    /**
     * Initializes a Twilio <-> Vapi streaming session for an inbound or outbound call.
     *
     * Sets up websocket listeners for the Twilio media stream, resolves company configuration,
     * boots the Vapi realtime session, and primes the service for subsequent audio forwarding
     * and call management.
     *
     * @param ws WebSocket connection received from Twilio's media stream webhook. Side-effect:
     * attaches `message`, `error`, and `close` handlers that forward media to Vapi via
     * {@link forwardAudioToTwilio} and eventually invoke {@link stopStreaming} when the socket
     * closes or errors.
     * @param callSid Twilio call identifier used for logging, repository lookups, and Vapi
     * session association.
     * @param streamSid Twilio media stream identifier returned to Twilio in `clear` events.
     * @param to Destination phone number for the call. Must be present—used to resolve the
     * owning company and their voice settings; streaming cannot continue without a match.
     * @param from Optional caller phone number. If omitted, we fall back to the value embedded in
     * the first Twilio media event (`initialEvent`). Used for caller tracking and transfer logic.
     * @param initialEvent Optional first media event payload received during stream setup. When
     * provided it is processed immediately to avoid dropping the initial audio frame and to infer
     * caller details if `from` is absent.
     *
     * @remarks
     * - Resets speech tracking counters and timestamps so that silence detection and usage logs
     *   behave correctly for each new call.
     * - Looks up company information, reply style, and scheduling context via injected services
     *   (`CompanyService`, `IVoiceRepository`, `SchedulingService`, etc.), then configures the
     *   {@link VapiClient} before establishing a realtime session.
     * - Registers Vapi session callbacks that can trigger downstream helpers like
     *   {@link transferCall} when a transfer is requested, and updates assistant/user speaking
     *   state used by {@link stopStreaming} heuristics.
     * - When the websocket errors or closes, `stopStreaming` is triggered to tear down resources
     *   and send the appropriate Twilio status events.
     */
    public async startStreaming(
        ws: WebSocket,
        callSid: string,
        streamSid: string,
        to: string,
        from: string | undefined,
        initialEvent?: TwilioMediaStreamEvent
    ) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.stopping = false;
        this.assistantSpeaking = false;
        this.resetSpeechTracking();
        this.twilioMessagesReceived = 0;
        this.twilioMediaEvents = 0;
        this.twilioMarksReceived = 0;
        this.totalAudioChunksForwardedToVapi = 0;
        this.totalMuLawBytesForwardedToVapi = 0;
        this.totalAssistantAudioChunks = 0;
        this.callStartedAt = new Date();
        this.activeCompanyId = null;
        this.callerNumber = this.extractSanitizedPhoneNumber(from) ?? this.extractFromNumber(initialEvent);
        this.usageRecorded = false;
        this.vapiCallId = null;

        console.log(`[${callSid}] Starting Vapi-powered voice session for ${to}`);

        ws.on("message", this.handleTwilioStreamMessage);
        ws.on("error", (error) => {
            console.error(`[${callSid}] Twilio stream websocket error`, error);
            this.stopStreaming("twilio stream error");
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
            this.stopStreaming("twilio socket closed");
        });

        if (initialEvent) {
            this.handleTwilioStreamEvent(initialEvent);
        }

        try {
            const company = await this.companyService.findByTwilioNumber(to);
            this.activeCompanyId = company.id;
            this.voiceSettings = await this.voiceRepository.fetchVoiceSettings(company.id);
            this.companyTwilioNumber = company.twilioNumber?.trim() || null;
            const companyContext = await this.companyService.getCompanyContext(company.id);
            this.companyTransferNumber = this.sanitizeTransferTarget(
                companyContext.contact?.phone ?? ""
            ) || null;
            const replyStyle = await this.voiceRepository.fetchReplyStyle(company.id);
            const schedulingContext = await this.schedulingService.getSchedulingContext(company.id);
            const hasGoogleIntegration = await this.integrationService.hasCalendarConnected(company.id);

            this.vapiClient.setCompanyInfo(
                callSid,
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

            const { session, callId } = await this.vapiClient.openRealtimeSession(
                callSid,
                {
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
                    onTransferCall: async ({ phoneNumber, callSid: requestedCallSid, callerId, reason }) => {
                        await this.transferCall(phoneNumber ?? "", {
                            callSid: requestedCallSid ?? undefined,
                            callerId: callerId ?? undefined,
                            reason: reason ?? undefined,
                        });
                        return {
                            transferredTo: phoneNumber ?? this.companyTransferNumber ?? null,
                            callSid: this.callSid,
                        };
                    },
                },
                { callerNumber: this.callerNumber }
            );

            this.vapiSession = session;
            const previousCallId = this.vapiCallId;
            if (previousCallId && previousCallId !== callId) {
                this.sessionManager?.releaseVapiCallId(previousCallId, this);
            }
            this.vapiCallId = callId ?? null;
            if (this.vapiCallId) {
                this.sessionManager?.associateVapiCallId(this.vapiCallId, this);
            }

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
        const activeCallSid = this.callSid;
        const callId = activeCallSid ?? "unknown";

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

    public stopStreaming(reason?: string) {
        if (this.stopping) {
            if (reason) {
                console.log(
                    `[${this.callSid ?? "unknown"}] stopStreaming already in progress (reason: ${reason})`
                );
            }
            return;
        }

        this.stopping = true;

        const activeCallSid = this.callSid;
        const callId = activeCallSid ?? "unknown";
        const formattedReason = reason ? ` (${reason})` : "";
        console.log(`[${callId}] Stopping Vapi voice session${formattedReason}`);
        this.logSessionSnapshot("twilio stop");

        if (this.activeCompanyId && this.callStartedAt && activeCallSid) {
            const companyId = this.activeCompanyId;
            const callSid = activeCallSid;
            const startedAt = this.callStartedAt;
            const endedAt = new Date();
            const fromNumber = this.callerNumber;
            const vapiCallId = this.vapiCallId;

            void this.callLogService
                .recordCallSession(companyId, callSid, fromNumber, vapiCallId, startedAt, endedAt)
                .catch((error) =>
                    console.error(
                        `[${callSid}] Failed to record call session for company ${companyId.toString()}`,
                        error
                    )
                );

            if (!this.usageRecorded) {
                this.usageRecorded = true;
                void this.usageService
                    .recordCall(companyId, callSid, startedAt, endedAt)
                    .catch((error) =>
                        console.error(
                            `[${callSid}] Failed to record usage for company ${companyId.toString()}`,
                            error
                        )
                    );
            }
        }
        try {
            if (this.ws) {
                this.ws.removeListener("message", this.handleTwilioStreamMessage);
            }
            this.terminateTwilioSocket("stop streaming");
            this.vapiSession?.close(1000, reason ? reason.slice(0, 100) : "stopped");
        } catch (error) {
            console.error("[VoiceService] Failed during stopStreaming cleanup", error);
            try {
                this.ws?.terminate();
            } catch {}
        }
        if (activeCallSid) {
            this.vapiClient.clearSessionConfig(activeCallSid);
        }
        if (this.vapiCallId) {
            this.sessionManager?.releaseVapiCallId(this.vapiCallId, this);
        }
        this.vapiSession = null;
        this.ws = null;
        this.callSid = null;
        this.streamSid = null;
        this.voiceSettings = null;
        this.callStartedAt = null;
        this.activeCompanyId = null;
        this.callerNumber = null;
        this.vapiCallId = null;
        this.assistantSpeaking = false;
        this.companyTwilioNumber = null;
        this.companyTransferNumber = null;
        this.resetSpeechTracking();
    }

    public getVapiCallId(): string | null {
        return this.vapiCallId;
    }

    public async handleVapiToolWebhook(body: unknown) {
        return this.vapiClient.handleToolWebhookRequest(body);
    }

    public async transferCall(
        target: string,
        options?: { callSid?: string; callerId?: string; reason?: string }
    ): Promise<void> {
        const activeCallSid = this.callSid;
        if (!activeCallSid) {
            throw new Error("Er is geen actief telefoongesprek om door te verbinden.");
        }

        if (options?.callSid && options.callSid !== activeCallSid) {
            throw new Error("Het opgegeven callSid komt niet overeen met de actieve oproep.");
        }

        let sanitizedTarget = this.sanitizeTransferTarget(target);
        if (!sanitizedTarget) {
            if (this.companyTransferNumber) {
                console.log(
                    `[${activeCallSid}] No valid transfer target supplied; defaulting to company contact number ${this.companyTransferNumber}.`
                );
            }
            sanitizedTarget = this.companyTransferNumber ?? "";
        }
        if (!sanitizedTarget) {
            throw new Error("Het opgegeven telefoonnummer voor doorverbinden is ongeldig.");
        }

        const sanitizedTwilioNumber = this.companyTwilioNumber
            ? this.sanitizeTransferTarget(this.companyTwilioNumber)
            : null;

        if (
            sanitizedTwilioNumber &&
            sanitizedTarget === sanitizedTwilioNumber &&
            this.companyTransferNumber
        ) {
            console.log(
                `[${activeCallSid}] Transfer target matched company Twilio number; using company contact number instead.`
            );
            sanitizedTarget = this.companyTransferNumber;
        }

        const callerId = options?.callerId?.trim() || this.companyTwilioNumber || undefined;

        console.log(
            `[${activeCallSid}] Initiating transfer to ${sanitizedTarget}${
                options?.reason ? ` (reason: ${options.reason})` : ""
            }`
        );

        await this.twilioClient.transferCall(activeCallSid, sanitizedTarget, callerId);

        // Clean up local session state; Twilio will end the media stream after the transfer.
        this.stopStreaming();
    }

    private sanitizeTransferTarget(target: string): string {
        if (!target) {
            return "";
        }

        const trimmed = target.trim();
        if (!trimmed) {
            return "";
        }

        if (trimmed.startsWith("sip:")) {
            return trimmed;
        }

        const cleaned = trimmed.replace(/[^+\d]/g, "");
        if (!cleaned) {
            return "";
        }

        if (cleaned.startsWith("+")) {
            const digits = cleaned.slice(1).replace(/[^\d]/g, "");
            return `+${digits}`;
        }

        return cleaned.replace(/[^\d]/g, "");
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

    private extractFromNumber(event?: TwilioMediaStreamEvent): string | null {
        if (!event?.start) {
            return null;
        }

        const start = event.start as Record<string, unknown> & {
            customParameters?: Record<string, unknown>;
        };

        const candidates: NullableString[] = [
            start.customParameters?.["from"] as NullableString,
            start["from"] as NullableString,
            start.customParameters?.["caller"] as NullableString,
            start["caller"] as NullableString,
        ];

        for (const candidate of candidates) {
            const sanitized = this.extractSanitizedPhoneNumber(
                typeof candidate === "string" ? candidate : null
            );
            if (sanitized) {
                return sanitized;
            }
        }

        return null;
    }

    private extractSanitizedPhoneNumber(value: NullableString): string | null {
        if (typeof value !== "string") {
            return null;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        return trimmed;
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
                if (!this.callerNumber) {
                    this.callerNumber = this.extractFromNumber(event);
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
                this.stopStreaming("twilio stop event");
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

    public handleTwilioStatusCallback(
        callSid: string | undefined,
        callStatus: string | undefined,
        rawEvent?: Record<string, unknown>
    ) {
        const normalizedStatus = (callStatus ?? "").toLowerCase();
        const relevantStatuses = new Set([
            "completed",
            "completed-by-redirect",
            "busy",
            "failed",
            "no-answer",
            "canceled",
        ]);

        const incomingCallSid = callSid ?? rawEvent?.["CallSid"];
        const callId = incomingCallSid ?? this.callSid ?? "unknown";

        console.log(
            `[${callId}] Received Twilio status callback: status=${callStatus ?? ""} callSid=${incomingCallSid ?? "unknown"}`
        );

        if (!relevantStatuses.has(normalizedStatus)) {
            return;
        }

        if (this.callSid && incomingCallSid && this.callSid !== incomingCallSid) {
            console.log(
                `[${callId}] Status callback does not match active callSid (${this.callSid}); skipping stop`
            );
            return;
        }

        this.stopStreaming(`twilio status callback (${normalizedStatus || "unknown"})`);
    }

    private terminateTwilioSocket(reason: string) {
        const socket = this.ws;
        if (!socket) {
            return;
        }

        if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
            return;
        }

        try {
            socket.close(1000, reason.slice(0, 120));
        } catch (error) {
            console.warn(
                `[${this.callSid ?? "unknown"}] Failed to close Twilio websocket gracefully (${reason}); terminating`,
                error
            );
            try {
                socket.terminate();
            } catch {}
        }
    }
}

type TwilioMediaStreamEvent = {
    event: string;
    start?: {
        callSid?: string;
        streamSid?: string;
        from?: string;
        to?: string;
        customParameters?: Record<string, unknown>;
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

type NullableString = string | null | undefined;
