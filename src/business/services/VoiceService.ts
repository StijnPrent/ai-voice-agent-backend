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
import { ProductKnowledgeService } from "./ProductKnowledgeService";

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
    private parentCallSid: string | null = null;
    private voiceSettings: VoiceSettingModel | null = null;
    private vapiSession: VapiRealtimeSession | null = null;
    private vapiCallId: string | null = null;
    private callStartedAt: Date | null = null;
    private activeCompanyId: bigint | null = null;
    private callerNumber: string | null = null;
    private callerName: string | null = null;
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
    @inject(ProductKnowledgeService) private readonly productKnowledgeService: ProductKnowledgeService,
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
     * @param to Destination phone number for the call. Must be presentâ€”used to resolve the
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
        this.parentCallSid = this.extractParentCallSid(initialEvent);

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
            this.callerName = await this.companyService.resolveCallerName(
                company.id,
                this.callerNumber
            );
            if (this.callerName) {
                console.log(
                    `[${callSid}] Matched caller name '${this.callerName}' for number ${this.callerNumber ?? "unknown"}`
                );
            }
            this.companyTransferNumber = this.sanitizeTransferTarget(
                companyContext.contact?.phone ?? ""
            ) || null;
            const replyStyle = await this.voiceRepository.fetchReplyStyle(company.id);
            const schedulingContext = await this.schedulingService.getSchedulingContext(company.id);
            const calendarStatus = await this.integrationService.getCalendarIntegrationStatus(company.id);
            const calendarProvider = this.integrationService.pickCalendarProvider(calendarStatus);
            const hasGoogleIntegration = this.integrationService.isCalendarConnected(calendarStatus);
            console.log("[VoiceService] fetching commerce connections for", company.id.toString());
            const commerce = await this.integrationService.getCommerceConnections(company.id);
            let commerceStores: Array<"shopify" | "woocommerce"> = [];
            if (commerce.shopify) commerceStores.push("shopify");
            if (commerce.woocommerce) commerceStores.push("woocommerce");

            if (commerceStores.length === 0) {
                const integrations = await this.integrationService.getAllWithStatus(company.id);
                console.log("[VoiceService] fallback integration scan for commerce", integrations.map(i => ({ name: i.name, status: i.status })));
                commerceStores = integrations
                    .filter((i) => i.status === "connected")
                    .map((i) => {
                        const name = i.name.toLowerCase();
                        if (name.includes("shopify")) return "shopify";
                        if (name.includes("woo")) return "woocommerce";
                        return null;
                    })
                    .filter((v): v is "shopify" | "woocommerce" => Boolean(v));
            }
            let productCatalog: Array<{
                id: string;
                name: string;
                sku?: string | null;
                summary?: string | null;
                synonyms?: string[];
                status: string;
                version?: number;
                updatedAt?: string;
            }> = [];

            try {
                const products = await this.productKnowledgeService.listCatalog(company.id, "published");
                productCatalog = products.map((product) => ({
                    id: product.id.toString(),
                    name: product.name,
                    sku: product.sku,
                    summary: product.summary ?? product.content.summary ?? null,
                    synonyms: product.synonyms,
                    status: product.status,
                    version: product.version,
                    updatedAt: product.updatedAt.toISOString(),
                }));
            } catch (error) {
                console.error(`[${callSid}] Failed to load product catalog`, error);
            }

            if (!company.assistantEnabled) {
                console.warn(
                    `[${callSid}] Assistant disabled for company ${company.id.toString()}; initiating direct transfer.`
                );
                const transferTarget = this.resolveTransferTarget();

                if (!transferTarget) {
                    console.error(
                        `[${callSid}] No transfer target available while assistant disabled; ending streaming session.`
                    );
                    this.stopStreaming("assistant disabled (no transfer target)");
                    return;
                }

                try {
                    await this.transferCall(transferTarget, {
                        callSid,
                        callerId: this.companyTwilioNumber ?? undefined,
                        reason: "assistant_disabled",
                    });
                } catch (transferError) {
                    console.error(
                        `[${callSid}] Failed to transfer call after assistant disabled`,
                        transferError
                    );
                } finally {
                    this.stopStreaming("assistant disabled (transferred)");
                }
                return;
            }

            this.vapiClient.setCompanyInfo(
                callSid,
                company,
                hasGoogleIntegration,
                calendarProvider,
                replyStyle,
                companyContext,
                schedulingContext,
                productCatalog,
                this.voiceSettings,
                commerceStores
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
                    onTransferCall: async ({ phoneNumber, callSid: requestedCallSid, callerId, reason }) => {
                        const effectiveCallSid = requestedCallSid ?? this.callSid;
                        console.log(
                            `[${callSid}] [VoiceService] transfer_call tool triggered`,
                            {
                                phoneNumber,
                                requestedCallSid,
                                callerId,
                                reason,
                                effectiveCallSid,
                            }
                        );

                        return this.transferCall(phoneNumber ?? undefined, {
                            callSid: effectiveCallSid,
                            callerId,
                            reason,
                        });
                    },
                    onSessionError: (err) => console.error(`[${callSid}] [Vapi] session error`, err),
                    onSessionClosed: () => {
                        console.log(`[${callSid}] [Vapi] session closed`);
                        this.logSessionSnapshot("vapi session closed");
                    },

                },
                { callerNumber: this.callerNumber, callerName: this.callerName }
            );

            this.vapiSession = session;
            const previousCallId = this.vapiCallId;
            if (previousCallId && previousCallId !== callId) {
                console.log(
                    `[${callSid}] [VoiceService] Releasing previous Vapi callId ${previousCallId} before registering new one`
                );
                this.sessionManager?.releaseVapiCallId(previousCallId, this);
            }
            this.vapiCallId = callId ?? null;
            console.log(
                `[${callSid}] [VoiceService] Vapi realtime session ready (callId=${this.vapiCallId ?? "none"})`
            );
            if (this.vapiCallId) {
                this.sessionManager?.associateVapiCallId(this.vapiCallId, this);
            } else {
                console.warn(`[${callSid}] [VoiceService] No Vapi callId returned for realtime session`);
            }

            console.log(`[${callSid}] Vapi session created`);
            this.logSessionSnapshot("vapi session created");

            // Trigger the welcome line by forcing an initial response turn
            this.vapiSession.commitUserAudio();
        } catch (error) {
            await this.handleVapiStartupFailure(to, error);
        }
    }

    public sendAudio(payload: string) {
        const activeCallSid = this.callSid;
        const callId = activeCallSid ?? "unknown";

        if (!this.vapiSession) {
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

        if (!this.userSpeaking && energy >= SPEECH_ENERGY_THRESHOLD) {
            this.userSpeaking = true;
            this.silenceFrames = 0;
            this.framesSinceLastCommit = 0;
            this.activeSpeechFrames = 0;
            this.cumulativeSpeechEnergy = 0;
            const callId = this.callSid ?? "unknown";
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
        this.parentCallSid = null;
        this.voiceSettings = null;
        this.callStartedAt = null;
        this.activeCompanyId = null;
        this.callerNumber = null;
        this.callerName = null;
        this.vapiCallId = null;
        this.assistantSpeaking = false;
        this.companyTwilioNumber = null;
        this.companyTransferNumber = null;
        this.resetSpeechTracking();
    }

    private async handleVapiStartupFailure(twilioToNumber: string, error: unknown) {
        const callSid = this.callSid ?? "unknown";
        console.error(`[${callSid}] Failed to start Vapi session`, error);
        this.logSessionSnapshot("vapi start failure");

        if (!this.companyTransferNumber) {
            try {
                const fallbackCompany = await this.companyService.findByTwilioNumber(twilioToNumber);
                const fallbackContext = await this.companyService.getCompanyContext(fallbackCompany.id);
                this.companyTransferNumber =
                    this.sanitizeTransferTarget(fallbackContext.contact?.phone ?? "") || null;
                this.companyTwilioNumber = fallbackCompany.twilioNumber?.trim() || null;
            } catch (lookupError) {
                console.error(
                    `[${callSid}] Failed to resolve fallback transfer number after Vapi failure`,
                    lookupError
                );
            }
        }

        const transferTarget = this.resolveTransferTarget();
        if (!transferTarget) {
            console.error(
                `[${callSid}] No company phone number available for fallback transfer; ending call after Vapi failure.`
            );
            this.stopStreaming("vapi start failure (no fallback target)");
            return;
        }

        const transferReason = "fallback_vapi_start_failure";
        try {
            console.log(
                `[${callSid}] Initiating fallback transfer to company phone ${transferTarget} after Vapi failure.`
            );
            await this.transferCall(transferTarget, {
                callerId: this.companyTwilioNumber ?? undefined,
                reason: transferReason,
            });
        } catch (transferError) {
            console.error(
                `[${callSid}] Fallback transfer to company phone failed after Vapi failure`,
                transferError
            );
        } finally {
            this.stopStreaming("fallback transfer initiated after vapi start failure");
        }
    }

    public async transferCall(
        phoneNumber?: string | null,
        options?: { callSid?: string | null; callerId?: string | null; reason?: string | null }
    ): Promise<{ transferredTo: string; callSid: string }> {
        const isTwilioCallSid = (value: string) => /^CA[a-zA-Z0-9]{32}$/.test(value.trim());

        // Only consider real Twilio callSids, prefer the live callSid, then parentCallSid, then any provided override.
        const rawCandidates = [
            this.callSid,
            this.parentCallSid,
            options?.callSid ?? null,
        ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

        const callSidCandidates = rawCandidates.filter(isTwilioCallSid);
        if (callSidCandidates.length === 0) {
            throw new Error("Er is geen actieve Twilio callSid beschikbaar om door te verbinden.");
        }

        const candidateTarget = phoneNumber ?? this.companyTransferNumber;
        const sanitizedTarget = this.sanitizeTransferTarget(candidateTarget ?? "");
        if (!sanitizedTarget) {
            throw new Error("Er is geen geldig doelnummer voor doorverbinden beschikbaar.");
        }

        // Prefer an explicit callerId, otherwise present the original caller number, then fall back to the company's Twilio number.
        const callerIdCandidate = options?.callerId ?? this.callerNumber ?? this.companyTwilioNumber ?? null;
        let sanitizedCallerId = callerIdCandidate
            ? this.sanitizeTransferTarget(callerIdCandidate)
            : null;

        if (!sanitizedCallerId) {
            const fallbackCallerId = process.env.TWILIO_FROM?.trim();
            if (fallbackCallerId) {
                sanitizedCallerId = this.sanitizeTransferTarget(fallbackCallerId);
                if (sanitizedCallerId) {
                    console.log(
                        `[${this.callSid ?? "unknown"}] Using fallback callerId from TWILIO_FROM environment variable (${sanitizedCallerId})`
                    );
                }
            }
        }

        if (!sanitizedCallerId) {
            console.warn(
                `[${this.callSid ?? "unknown"}] No callerId configured for transfer; Twilio may reject the dial. Configure a valid Twilio number.`
            );
        }

        const reasonLog = options?.reason ? ` (reden: ${options.reason})` : "";
        let lastError: unknown;

        for (const candidate of callSidCandidates) {
            const callSid = candidate.trim();
            console.log(
                `[${callSid}] Doorverbinden naar ${sanitizedTarget}${
                    sanitizedCallerId ? ` met callerId ${sanitizedCallerId}` : ""
                }${reasonLog}`
            );

            try {
                await this.twilioClient.transferCall(callSid, sanitizedTarget, {
                    callerId: sanitizedCallerId,
                    reason: options?.reason ?? null,
                });
                return { transferredTo: sanitizedTarget, callSid };
            } catch (error) {
                lastError = error;
                console.error(`[${callSid}] Doorverbinden mislukt`, error);
            }
        }

        throw (
            lastError instanceof Error
                ? lastError
                : new Error("Doorverbinden mislukt door een onbekende fout.")
        );
    }public getVapiCallId(): string | null {
        return this.vapiCallId;
    }

    public getCallSid(): string | null {
        return this.callSid;
    }

    public getParentCallSid(): string | null {
        return this.parentCallSid;
    }

    public async handleVapiToolWebhook(body: unknown) {
        const callSid = this.callSid ?? "unknown";
        const contextLabel = VapiClient.formatToolLogContext({
            callSid: this.callSid,
        });

        try {
            const preview = this.safeSerialize(body);
            console.log(`[${callSid}] [VoiceService] â‡¦ Delegated tool webhook payload ${contextLabel}`, preview);
        } catch (error) {
            console.warn(`[${callSid}] [VoiceService] âš ï¸ Failed to preview incoming tool webhook ${contextLabel}`, error);
        }

        const result = await this.vapiClient.handleToolWebhookRequest(body);

        try {
            const preview = this.safeSerialize(result);
            console.log(`[${callSid}] [VoiceService] â‡¨ Tool webhook response ${contextLabel}`, preview);
        } catch (error) {
            console.warn(`[${callSid}] [VoiceService] âš ï¸ Failed to preview outgoing tool webhook response ${contextLabel}`, error);
        }

        return result;
    }

    private resolveTransferTarget(): string | null {
        const callId = this.callSid ?? "unknown";

        if (this.companyTransferNumber) {
            return this.companyTransferNumber;
        }

        const envFallback = this.sanitizeTransferTarget(process.env.TWILIO_TO ?? "");
        if (envFallback) {
            console.log(
                `[${callId}] Using TWILIO_TO as fallback transfer target: ${envFallback}`
            );
            this.companyTransferNumber = envFallback;
            return envFallback;
        }

        const twilioNumber = this.sanitizeTransferTarget(this.companyTwilioNumber ?? "");
        if (twilioNumber) {
            console.log(
                `[${callId}] Using company Twilio number as last-resort transfer target: ${twilioNumber}`
            );
            this.companyTransferNumber = twilioNumber;
            return twilioNumber;
        }

        return null;
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

    private safeSerialize(value: unknown, limit = 2000): string {
        try {
            const serialized = JSON.stringify(value, null, 2);
            if (!serialized) {
                return "<empty>";
            }

            if (serialized.length <= limit) {
                return serialized;
            }

            return `${serialized.slice(0, limit)}â€¦ (truncated ${serialized.length - limit} chars)`;
        } catch (error) {
            return `[unserializable: ${(error as Error)?.message ?? "unknown error"}]`;
        }
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

    private extractParentCallSid(event?: TwilioMediaStreamEvent): string | null {
        if (!event?.start) {
            return null;
        }

        const start = event.start as Record<string, unknown> & {
            customParameters?: Record<string, unknown>;
        };

        const candidates: Array<unknown> = [
            start["parentCallSid"],
            start["parent_call_sid"],
            start.customParameters?.["parentCallSid"],
            start.customParameters?.["parent_call_sid"],
            start.customParameters?.["ParentCallSid"],
        ];

        for (const candidate of candidates) {
            if (typeof candidate === "string") {
                const trimmed = candidate.trim();
                if (trimmed) {
                    return trimmed;
                }
            }
        }

        return null;
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
                const parentCallSid = this.extractParentCallSid(event);
                if (parentCallSid) {
                    this.parentCallSid = parentCallSid;
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

    public handleDialCallback(kind: "action" | "status", payload: Record<string, unknown>) {
        const callSid = typeof payload?.["CallSid"] === "string" ? payload["CallSid"] : this.callSid;
        const dialCallSid = typeof payload?.["DialCallSid"] === "string" ? payload["DialCallSid"] : null;
        const dialCallStatus =
            typeof payload?.["DialCallStatus"] === "string" ? payload["DialCallStatus"] : null;
        const callStatus = typeof payload?.["CallStatus"] === "string" ? payload["CallStatus"] : null;

        const contextParts = [
            `[${callSid ?? "unknown"}]`,
            `[Dial ${kind}]`,
            dialCallSid ? `DialCallSid=${dialCallSid}` : "DialCallSid=<missing>",
            dialCallStatus ? `DialCallStatus=${dialCallStatus}` : "DialCallStatus=<missing>",
            callStatus ? `CallStatus=${callStatus}` : "CallStatus=<missing>",
        ];

        console.log(contextParts.join(" "));

        try {
            const preview = this.safeSerialize(payload, 1500);
            console.log(`${contextParts[0]} [Dial ${kind}] payload=${preview}`);
        } catch (error) {
            console.warn(
                `${contextParts[0]} [Dial ${kind}] âš ï¸ Failed to serialize payload`,
                error instanceof Error ? error.message : error
            );
        }
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
        parentCallSid?: string;
        parent_call_sid?: string;
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

