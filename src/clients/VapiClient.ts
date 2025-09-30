// src/clients/VapiClient.ts
import axios, { AxiosInstance } from "axios";
import WebSocket from "ws";
import { inject, injectable } from "tsyringe";
import { CompanyModel } from "../business/models/CompanyModel";
import { ReplyStyleModel } from "../business/models/ReplyStyleModel";
import { CompanyInfoModel } from "../business/models/CompanyInfoModel";
import { CompanyDetailsModel } from "../business/models/CompanyDetailsModel";
import { CompanyHourModel } from "../business/models/CompanyHourModel";
import { CompanyContactModel } from "../business/models/CompanyContactModel";
import { AppointmentTypeModel } from "../business/models/AppointmentTypeModel";
import { StaffMemberModel } from "../business/models/StaffMemberModel";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";
import { GoogleService } from "../business/services/GoogleService";
import { summarizeSlots } from "../utils/tts/SummerizeSlots";

type CompanyContext = {
    details: CompanyDetailsModel | null;
    contact: CompanyContactModel | null;
    hours: CompanyHourModel[];
    info: CompanyInfoModel[];
};

type SchedulingContext = {
    appointmentTypes: AppointmentTypeModel[];
    staffMembers: StaffMemberModel[];
};

type CompanySnapshot = {
    companyId: string;
    companyName: string;
    industry?: string;
    description?: string;
    contact?: {
        email?: string;
        phone?: string;
        website?: string;
        address?: string;
    };
    hours?: { day: string; isOpen: boolean; ranges?: string[] }[];
    info?: string[];
    appointmentTypes?: { name: string; durationMinutes?: number }[];
    staffMembers?: {
        name: string;
        role?: string;
        availability?: { day: string; ranges: string[] }[];
    }[];
};

export type VapiAssistantConfig = {
    company: CompanyModel;
    hasGoogleIntegration: boolean;
    replyStyle: ReplyStyleModel;
    companyContext: CompanyContext;
    schedulingContext: SchedulingContext;
    voiceSettings: VoiceSettingModel;
};

export type VapiRealtimeCallbacks = {
    onAudio: (audioBase64: string) => void;
    onText?: (text: string) => void;
    onToolStatus?: (message: string) => void;
    onSessionError?: (error: Error) => void;
    onSessionClosed?: () => void;
};

export type NormalizedToolCall = {
    id: string;
    name: string;
    args: Record<string, unknown>;
};

class VapiRealtimeSession {
    private closed = false;
    constructor(private readonly socket: WebSocket) {}

    public sendAudioChunk(audioBase64: string) {
        if (this.closed) return;
        this.socket.send(
          JSON.stringify({
              type: "input_audio_buffer.append",
              audio: audioBase64,
          })
        );
    }

    public commitUserAudio() {
        if (this.closed) return;
        this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        this.socket.send(JSON.stringify({ type: "response.create", response: {} }));
    }

    public sendToolResponse(toolCallId: string, payload: unknown) {
        if (this.closed) return;
        this.socket.send(
          JSON.stringify({
              type: "tool.response.create",
              tool_response: {
                  tool_call_id: toolCallId,
                  output:
                    typeof payload === "string"
                      ? payload
                      : JSON.stringify(payload ?? {}),
              },
          })
        );
    }

    public close(code?: number, reason?: string) {
        if (this.closed) return;
        this.closed = true;
        try {
            this.socket.close(code, reason);
        } catch (error) {
            console.error("[VapiRealtimeSession] Failed to close socket", error);
        }
    }
}

@injectable()
export class VapiClient {
    private readonly apiKey: string;
    private readonly http: AxiosInstance;
    private readonly apiPathPrefix: string;
    private readonly modelProvider: string;
    private readonly modelName: string;
    private readonly assistantCache = new Map<string, string>();
    private readonly toolBaseUrl: string;

    private company: CompanyModel | null = null;
    private hasGoogleIntegration = false;
    private replyStyle: ReplyStyleModel | null = null;
    private companyContext: CompanyContext | null = null;
    private schedulingContext: SchedulingContext | null = null;
    private voiceSettings: VoiceSettingModel | null = null;
    private currentConfig: VapiAssistantConfig | null = null;

    constructor(@inject(GoogleService) private readonly googleService: GoogleService) {
        this.apiKey = process.env.VAPI_API_KEY || "";
        if (!this.apiKey) {
            console.warn("[VapiClient] VAPI_API_KEY is not set. Requests to Vapi will fail.");
        }

        const apiBaseUrl = process.env.VAPI_API_BASE_URL || "https://api.vapi.ai";
        this.apiPathPrefix = this.normalizePathPrefix(process.env.VAPI_API_PATH_PREFIX ?? "");
        this.modelProvider = process.env.VAPI_MODEL_PROVIDER || "openai";
        this.modelName = process.env.VAPI_MODEL_NAME || "gpt-4o-mini";

        this.toolBaseUrl = (process.env.VAPI_TOOL_BASE_URL || process.env.SERVER_URL || "").replace(/\/$/, "");

        this.http = axios.create({
            baseURL: apiBaseUrl,
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            timeout: 15000,
        });
    }

    private normalizePathPrefix(prefix: string): string {
        if (!prefix) return "";
        const trimmed = prefix.trim();
        if (!trimmed) return "";
        return trimmed.replace(/^\/+|\/+$|\s+/g, "");
    }

    private buildApiPath(path: string): string {
        if (!path.startsWith("/")) {
            throw new Error(`[VapiClient] API paths must start with '/'. Received: ${path}`);
        }
        const normalizedPath = path.replace(/^\/+/, "");
        const segments = [this.apiPathPrefix, normalizedPath].filter((s) => s.length > 0);
        return `/${segments.join("/")}`;
    }

    public setCompanyInfo(
      company: CompanyModel,
      hasGoogleIntegration: boolean,
      replyStyle: ReplyStyleModel,
      context: CompanyContext,
      schedulingContext: SchedulingContext,
      voiceSettings: VoiceSettingModel
    ) {
        this.company = company;
        this.hasGoogleIntegration = hasGoogleIntegration;
        this.replyStyle = replyStyle;
        this.companyContext = context;
        this.schedulingContext = schedulingContext;
        this.voiceSettings = voiceSettings;
        this.currentConfig = {
            company,
            hasGoogleIntegration,
            replyStyle,
            companyContext: context,
            schedulingContext,
            voiceSettings,
        };

        if (company.assistantId) {
            this.assistantCache.set(company.id.toString(), company.assistantId);
        }
    }

    public buildSystemPrompt(config?: VapiAssistantConfig): string {
        const effectiveConfig = config ?? this.currentConfig;
        if (!effectiveConfig) {
            throw new Error(
              "Company info, reply style, context, and scheduling context must be set before generating a system prompt."
            );
        }

        const today = new Date().toLocaleDateString("nl-NL", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });

        const context = this.buildCompanySnapshot(effectiveConfig);
        const contextJson = JSON.stringify(context);

        const instructions: string[] = [
            `Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '${effectiveConfig.company.name}'. ${effectiveConfig.replyStyle.description}`,
            "Praat natuurlijk en menselijk en help de beller snel verder.",
            `Vandaag is het ${today}. Vermijd numerieke datum- en tijdnotatie (zoals 'dd-mm-jj' of '10:00'); gebruik natuurlijke taal, bijvoorbeeld 'tien uur' of '14 augustus 2025'.`,
            "Gebruik altijd de onderstaande bedrijfscontext. Als je informatie niet zeker weet of ontbreekt, communiceer dit dan duidelijk en bied alternatieve hulp aan.",
        ];

        if (effectiveConfig.voiceSettings?.welcomePhrase) {
            instructions.push(
              `Start elk gesprek vriendelijk met de welkomstboodschap: "${effectiveConfig.voiceSettings.welcomePhrase}".`
            );
        }

        if (effectiveConfig.hasGoogleIntegration) {
            instructions.push(
              "Je hebt toegang tot de Google Agenda van het bedrijf. Gebruik altijd eerst de tool 'check_calendar_availability' voordat je een tijdstip voorstelt en vraag om naam en geboortedatum voordat je 'create_calendar_event' of 'cancel_calendar_event' gebruikt. Vraag altijd expliciet of de afspraak definitief ingepland mag worden."
            );
        } else {
            instructions.push(
              "Je hebt geen toegang tot een agenda. Wanneer iemand een afspraak wil plannen, bied dan aan om een bericht door te geven of om de beller met een medewerker te verbinden."
            );
        }

        instructions.push("Bedrijfscontext (JSON):", contextJson);
        return instructions.join("\n\n");
    }

    private buildCompanySnapshot(config: VapiAssistantConfig): CompanySnapshot {
        const limitString = (value: string | null | undefined, max = 240) => {
            if (!value) return undefined;
            const trimmed = value.trim();
            if (!trimmed) return undefined;
            if (trimmed.length <= max) return trimmed;
            return `${trimmed.slice(0, max - 1)}…`;
        };

        const dayNames = [
            "Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag",
        ];
        const getDayName = (index: number) => dayNames[((index % 7) + 7) % 7] ?? `Dag ${index}`;

        const hours = (config.companyContext.hours ?? [])
          .slice(0, 7)
          .map((hour) => {
              const isOpen = Boolean(hour.isOpen && hour.openTime && hour.closeTime);
              const entry: { day: string; isOpen: boolean; ranges?: string[] } = {
                  day: getDayName(hour.dayOfWeek),
                  isOpen,
              };

              if (isOpen) {
                  entry.ranges = [`${hour.openTime} - ${hour.closeTime}`];
              }

              return entry;
          })
          .filter((entry) => entry.isOpen || Boolean(entry.ranges && entry.ranges.length));

        const info = (config.companyContext.info ?? [])
          .filter((entry) => entry.value)
          .slice(0, 10)
          .map((entry) => limitString(entry.value, 320))
          .filter((value): value is string => Boolean(value));

        const appointmentTypes = (config.schedulingContext.appointmentTypes ?? [])
          .slice(0, 8)
          .map((appointment) => {
              const trimmedName = typeof appointment.name === "string"
                  ? appointment.name.trim()
                  : "";

              const entry: { name: string; durationMinutes?: number } = {
                  name: trimmedName || appointment.name || "",
              };

              if (typeof appointment.duration === "number") {
                  entry.durationMinutes = appointment.duration;
              }

              return entry;
          })
          .filter((appointment) => Boolean(appointment.name));

        const staffMembers = (config.schedulingContext.staffMembers ?? [])
          .slice(0, 5)
          .map((staff) => {
              const grouped = new Map<number, string[]>();
              (staff.availability ?? [])
                .filter((slot) => slot.isActive && slot.startTime && slot.endTime)
                .forEach((slot) => {
                    const ranges = grouped.get(slot.dayOfWeek) ?? [];
                    if (ranges.length < 3) {
                        ranges.push(`${slot.startTime} - ${slot.endTime}`);
                        grouped.set(slot.dayOfWeek, ranges);
                    }
                });

              const availability = Array.from(grouped.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([dayOfWeek, ranges]) => ({
                    day: getDayName(dayOfWeek),
                    ranges,
                }))
                .filter((slot) => slot.ranges.length > 0);

              const result: {
                  name: string;
                  role?: string;
                  availability?: { day: string; ranges: string[] }[];
              } = {
                  name: staff.name,
              };

              if (staff.role) {
                  result.role = staff.role;
              }

              if (availability.length > 0) {
                  result.availability = availability;
              }

              return result;
          })
          .filter((staff) => Object.keys(staff).length > 1);

        const contact: Record<string, string> = {};
        const email = limitString(config.companyContext.contact?.contact_email);
        const phone = limitString(config.companyContext.contact?.phone);
        const website = limitString(config.companyContext.contact?.website);
        const address = limitString(config.companyContext.contact?.address, 320);

        if (email) contact.email = email;
        if (phone) contact.phone = phone;
        if (website) contact.website = website;
        if (address) contact.address = address;

        const snapshot: CompanySnapshot = {
            companyId: config.company.id.toString(),
            companyName: config.company.name,
        };

        const industry = limitString(config.companyContext.details?.industry);
        const description = limitString(config.companyContext.details?.description, 400);

        if (industry) snapshot.industry = industry;
        if (description) snapshot.description = description;
        if (Object.keys(contact).length > 0) snapshot.contact = contact;
        if (hours.length > 0) snapshot.hours = hours;
        if (info.length > 0) snapshot.info = info;
        if (appointmentTypes.length > 0) snapshot.appointmentTypes = appointmentTypes;
        if (staffMembers.length > 0) snapshot.staffMembers = staffMembers;

        return snapshot;
    }

    /** ===== Tools (clean JSON Schema via `parameters`) ===== */
    public getTools(hasGoogleIntegration?: boolean) {
        const enabled = hasGoogleIntegration ?? this.hasGoogleIntegration;
        if (!enabled) return [];

        const createCalendarParameters = {
            type: "object",
            properties: {
                summary:       { type: "string", description: "Titel van de afspraak" },
                location:      { type: "string", description: "Locatie van de afspraak" },
                description:   { type: "string", description: "Aanvullende details" },
                start:         { type: "string", description: "Start in ISO 8601 (bijv. 2025-07-21T10:00:00+02:00)" },
                end:           { type: "string", description: "Einde in ISO 8601" },
                name:          { type: "string", description: "Volledige naam van de klant" },
                attendeeEmail: { type: "string", description: "E-mailadres van de klant" },
                dateOfBirth:   { type: "string", description: "Geboortedatum DD-MM-YYYY" }
            },
            required: ["summary", "start", "end", "name", "dateOfBirth"]
        };

        const checkAvailabilityParameters = {
            type: "object",
            properties: {
                date: { type: "string", description: "Datum (YYYY-MM-DD) om te controleren" }
            },
            required: ["date"]
        };

        const cancelCalendarParameters = {
            type: "object",
            properties: {
                eventId:     { type: "string", description: "ID van het te annuleren event" },
                name:        { type: "string", description: "Naam van de klant (verificatie)" },
                dateOfBirth: { type: "string", description: "Geboortedatum DD-MM-YYYY (verificatie)" },
                reason:      { type: "string", description: "Reden van annulering" }
            },
            required: ["eventId", "name", "dateOfBirth"]
        };

        return [
            {
                type: "function",
                name: "create_calendar_event",
                description:
                  "Maak een nieuw event in Google Agenda. Vraag eerst datum/tijd; daarna naam en geboortedatum ter verificatie.",
                parameters: createCalendarParameters
            },
            {
                type: "function",
                name: "check_calendar_availability",
                description:
                  "Controleer beschikbare tijdsloten in Google Agenda voor een opgegeven datum.",
                parameters: checkAvailabilityParameters
            },
            {
                type: "function",
                name: "cancel_calendar_event",
                description:
                  "Annuleer een bestaand event in Google Agenda na verificatie met naam + geboortedatum.",
                parameters: cancelCalendarParameters
            }
        ];
    }

    private buildModelMessages(
      instructions: string,
      companyContext: CompanySnapshot,
      config: VapiAssistantConfig
    ) {
        const companyPayload: Record<string, unknown> = {
            id: companyContext.companyId,
            name: companyContext.companyName,
        };

        if (companyContext.industry) companyPayload.industry = companyContext.industry;
        if (companyContext.description) companyPayload.description = companyContext.description;
        if (companyContext.contact) companyPayload.contact = companyContext.contact;
        if (companyContext.hours && companyContext.hours.length > 0) {
            companyPayload.hours = companyContext.hours;
        }
        if (companyContext.info && companyContext.info.length > 0) {
            companyPayload.info = companyContext.info;
        }

        const scheduling: Record<string, unknown> = {};
        if (companyContext.appointmentTypes && companyContext.appointmentTypes.length > 0) {
            scheduling.appointmentTypes = companyContext.appointmentTypes;
        }
        if (companyContext.staffMembers && companyContext.staffMembers.length > 0) {
            scheduling.staffMembers = companyContext.staffMembers;
        }

        const contextPayload: Record<string, unknown> = {
            company: companyPayload,
            replyStyle: {
                name: config.replyStyle.name,
                description: config.replyStyle.description,
            },
            googleCalendarEnabled: config.hasGoogleIntegration,
        };

        if (Object.keys(scheduling).length > 0) {
            contextPayload.scheduling = scheduling;
        }

        const messageContent = [
            instructions.trim(),
            "",
            "Bedrijfscontext (JSON):",
            JSON.stringify(contextPayload, null, 2),
        ]
          .filter((part) => part.length > 0)
          .join("\n");

        return [
            {
                role: "system",
                content: messageContent,
            },
        ];
    }

    private buildModelApiTools(config: VapiAssistantConfig) {
        if (!config.hasGoogleIntegration) return [];
        if (!this.toolBaseUrl) {
            console.warn(
              "[VapiClient] Tool base URL is not configured; skipping API request tools for Google Calendar."
            );
            return [];
        }

        const join = (path: string) =>
            `${this.toolBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;

        return [
            {
                type: "apiRequest",
                name: "check_calendar_availability",
                description:
                  "Controleer beschikbare tijden in Google Agenda door een datum en openingstijden te versturen.",
                method: "POST",
                url: join("/google/availability"),
            },
            {
                type: "apiRequest",
                name: "create_calendar_event",
                description:
                  "Maak een afspraak in Google Agenda. Verstuur klantgegevens, datum en tijd als JSON body.",
                method: "POST",
                url: join("/google/schedule"),
            },
            {
                type: "apiRequest",
                name: "cancel_calendar_event",
                description:
                  "Annuleer een bestaande afspraak in Google Agenda met het event ID en verificatiegegevens.",
                method: "POST",
                url: join("/google/cancel"),
            },
        ];
    }

    public async openRealtimeSession(
      callSid: string,
      callbacks: VapiRealtimeCallbacks
    ): Promise<VapiRealtimeSession> {
        const config = this.currentConfig;
        if (!config || !this.company || !this.replyStyle || !this.companyContext || !this.schedulingContext) {
            throw new Error("Company must be configured before opening a Vapi session");
        }

        const assistantId = await this.syncAssistant(config);
        const prompt = this.buildSystemPrompt(config);

        const { primaryUrl, fallbackUrls, callId } = await this.createWebsocketCall(
            assistantId,
            callSid
        );

        const candidates = [primaryUrl, ...fallbackUrls].filter((url, index, arr) => {
            return typeof url === "string" && url.startsWith("ws") && arr.indexOf(url) === index;
        });

        if (candidates.length === 0) {
            throw new Error("Vapi did not return a websocket URL for the realtime session");
        }

        const { socket: ws, url: connectedUrl } = await this.establishRealtimeSocket(
            candidates,
            callSid
        );

        console.log(
            `[${callSid}] [Vapi] realtime session opened via ${connectedUrl}` +
                (callId ? ` (callId=${callId})` : "")
        );

        const session = new VapiRealtimeSession(ws);

        // Geen tools meesturen: die zitten al op de assistant
        const updatePayload: any = {
            type: "session.update",
            session: {
                instructions: prompt,
                modalities: ["audio"],
                input_audio_format: { encoding: "mulaw", sample_rate: 8000 },
                output_audio_format: { encoding: "mulaw", sample_rate: 8000 },
                // voice uit assistant gebruiken; stuur alleen override als je live wil afwijken
                metadata: {
                    companyId: config.company.id.toString(),
                    companyName: config.company.name,
                    googleCalendarEnabled: config.hasGoogleIntegration,
                },
            },
        };

        try {
            ws.send(JSON.stringify(updatePayload));
        } catch (error) {
            console.error(`[${callSid}] [Vapi] Failed to send session update`, error);
        }

        ws.on("message", async (raw: WebSocket.RawData) => {
            try {
                const event = JSON.parse(raw.toString());
                await this.handleRealtimeEvent(event, session, callbacks);
            } catch (error) {
                console.error(`[${callSid}] [Vapi] Failed to process event`, error);
            }
        });

        ws.on("close", (code) => {
            console.log(`[${callSid}] [Vapi] realtime session closed with code ${code}`);
            callbacks.onSessionClosed?.();
        });

        ws.on("error", (error) => {
            console.error(`[${callSid}] [Vapi] realtime session error`, error);
            callbacks.onSessionError?.(error as Error);
        });

        return session;
    }

    private async establishRealtimeSocket(
        candidateUrls: string[],
        callSid: string
    ): Promise<{ socket: WebSocket; url: string }> {
        const errors: Error[] = [];
        const visited = new Set<string>();

        for (const candidate of candidateUrls) {
            const url = candidate;
            if (visited.has(url)) {
                continue;
            }

            try {
                const { socket, finalUrl } = await this.connectRealtimeSocket(url, callSid, visited);
                if (finalUrl !== url) {
                    console.warn(
                        `[${callSid}] [Vapi] websocket redirected from ${url} to ${finalUrl}`
                    );
                }
                return { socket, url: finalUrl };
            } catch (error) {
                const err =
                    error instanceof Error
                        ? error
                        : new Error(`Unknown realtime connection error: ${String(error)}`);
                errors.push(err);
                console.error(
                    `[${callSid}] [Vapi] Failed to open realtime socket at ${url}: ${err.message}`
                );
            }
        }

        const aggregate = new Error(
            `Unable to establish Vapi realtime connection after ${candidateUrls.length} attempts.`
        );
        (aggregate as any).causes = errors;
        throw aggregate;
    }

    private async createWebsocketCall(
        assistantId: string,
        callSid: string
    ): Promise<{ primaryUrl: string; fallbackUrls: string[]; callId?: string | null }> {
        const transport: Record<string, unknown> = {
            type: "websocket",
            websocket: {
                audio: {
                    encoding: "mulaw",
                    sampleRate: 8000,
                },
            },
        };

        const metadata: Record<string, unknown> = {
            callSid,
        };

        if (this.company) {
            metadata.companyId = this.company.id.toString();
            metadata.companyName = this.company.name;
        }

        if (Object.keys(metadata).length > 0) {
            (transport.websocket as Record<string, unknown>).metadata = metadata;
        }

        const payload = {
            assistantId,
            transport,
        };

        try {
            const response = await this.http.post(this.buildApiPath("/call"), payload);
            const info = this.extractWebsocketCallInfo(response.data);
            if (!info) {
                throw new Error("Vapi create call response did not include a websocket URL");
            }
            return info;
        } catch (error) {
            this.logAxiosError("[VapiClient] Failed to create websocket call", error, payload);
            throw error;
        }
    }

    private extractWebsocketCallInfo(
        data: any
    ): { primaryUrl: string; fallbackUrls: string[]; callId?: string | null } | null {
        if (!data) return null;

        const containers = [data, data?.data, data?.call, data?.result, data?.response];
        const urls = new Set<string>();
        const fallbackUrls = new Set<string>();
        let callId: string | null = null;

        const addUrl = (value: unknown, target: Set<string>) => {
            if (typeof value === "string" && value.startsWith("ws")) {
                target.add(value);
            }
        };

        const visit = (value: unknown, path: string[] = []) => {
            if (!value) return;

            if (typeof value === "string") {
                if (value.startsWith("ws")) {
                    const key = path[path.length - 1]?.toLowerCase() ?? "";
                    if (key.includes("fallback")) {
                        fallbackUrls.add(value);
                    } else {
                        urls.add(value);
                    }
                } else if (!callId && path[path.length - 1] === "id" && path.includes("call")) {
                    callId = value;
                } else if (!callId && path[path.length - 1] === "callId") {
                    callId = value;
                }
                return;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    visit(item, path);
                }
                return;
            }

            if (typeof value === "object") {
                for (const [key, nested] of Object.entries(value)) {
                    const lowerKey = key.toLowerCase();
                    if (lowerKey === "websocketcallurl" || lowerKey === "url") {
                        addUrl(nested, urls);
                    } else if (lowerKey.includes("fallback") && Array.isArray(nested)) {
                        nested.forEach((item) => addUrl(item, fallbackUrls));
                    }
                    visit(nested, [...path, key]);
                }
            }
        };

        for (const container of containers) {
            visit(container ?? {}, []);
        }

        if (urls.size === 0 && fallbackUrls.size === 0) {
            return null;
        }

        const [primaryUrl] = urls.size > 0 ? Array.from(urls) : Array.from(fallbackUrls);
        const remainingFallbacks = new Set<string>();
        for (const url of urls) {
            if (url !== primaryUrl) {
                remainingFallbacks.add(url);
            }
        }
        for (const url of fallbackUrls) {
            if (url !== primaryUrl && !remainingFallbacks.has(url)) {
                remainingFallbacks.add(url);
            }
        }

        return {
            primaryUrl,
            fallbackUrls: Array.from(remainingFallbacks),
            callId,
        };
    }

    private async connectRealtimeSocket(
        url: string,
        callSid: string,
        visited: Set<string>
    ): Promise<{ socket: WebSocket; finalUrl: string }> {
        if (visited.has(url)) {
            throw new Error(
              `[${callSid}] [Vapi] Realtime handshake loop detected when revisiting ${url}`
            );
        }
        visited.add(url);

        return new Promise<{ socket: WebSocket; finalUrl: string }>((resolve, reject) => {
            const socket = new WebSocket(url, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });

            let settled = false;

            const cleanup = () => {
                socket.removeListener("open", onOpen);
                socket.removeListener("error", onError);
                socket.removeListener("unexpected-response", onUnexpectedResponse);
            };

            const swallowHandshakeError = (err: Error) => {
                console.warn(
                    `[${callSid}] [Vapi] realtime socket error after unexpected response: ${err.message}`
                );
            };

            const safeShutdown = (action: () => void) => {
                socket.once("error", swallowHandshakeError);
                socket.once("close", () => {
                    socket.removeListener("error", swallowHandshakeError);
                });
                try {
                    action();
                } catch {}
            };

            const finalizeWithError = (message: string, body: string) => {
                if (settled) return;
                settled = true;
                cleanup();
                safeShutdown(() => socket.close());
                reject(new Error(message + (body ? ` – ${body}` : "")));
            };

            const onOpen = () => {
                settled = true;
                cleanup();
                resolve({ socket, finalUrl: url });
            };

            const onError = (err: Error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };

            const onUnexpectedResponse = (_req: any, res: any) => {
                if (settled) return;
                const statusCode = res?.statusCode;
                const statusMessage = res?.statusMessage;
                const chunks: Buffer[] = [];
                let finalized = false;

                const attemptFallback = (body: string) => {
                    const fallbackUrl = this.extractRealtimeUrlFromBody(body);
                    if (!fallbackUrl || visited.has(fallbackUrl)) {
                        return false;
                    }

                    console.warn(
                        `[${callSid}] [Vapi] Unexpected realtime handshake response ${statusCode ?? "unknown"}` +
                            (statusMessage ? ` ${statusMessage}` : "") +
                            ` while connecting to ${url}. Trying fallback websocket ${fallbackUrl}`
                    );

                    cleanup();
                    safeShutdown(() => socket.terminate());

                    this.connectRealtimeSocket(fallbackUrl, callSid, visited)
                        .then((result) => {
                            if (settled) {
                                result.socket.close();
                                return;
                            }
                            settled = true;
                            resolve(result);
                        })
                        .catch((fallbackError) => {
                            if (settled) return;
                            settled = true;
                            reject(fallbackError);
                        });

                    return true;
                };

                const finalize = () => {
                    if (finalized || settled) return;
                    finalized = true;
                    const body = Buffer.concat(chunks).toString("utf8");

                    if (attemptFallback(body)) {
                        return;
                    }

                    const message =
                        `[${callSid}] Unexpected realtime handshake response ${statusCode ?? "unknown"}` +
                        (statusMessage ? ` ${statusMessage}` : "");

                    finalizeWithError(message, body);
                };

                res?.on("data", (chunk: Buffer) => chunks.push(chunk));
                res?.on("end", finalize);
                res?.on("close", finalize);
                res?.on("error", finalize);
            };

            socket.once("open", onOpen);
            socket.once("error", onError);
            socket.once("unexpected-response", onUnexpectedResponse);
        });
    }

    private extractRealtimeUrlFromBody(body: string): string | null {
        if (!body) return null;
        const trimmed = body.trim();
        if (!trimmed) return null;

        const visit = (value: unknown): string | null => {
            if (typeof value === "string") {
                return value.startsWith("wss://") ? value : null;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    const found = visit(item);
                    if (found) return found;
                }
            } else if (value && typeof value === "object") {
                for (const key of Object.keys(value)) {
                    const found = visit((value as Record<string, unknown>)[key]);
                    if (found) return found;
                }
            }

            return null;
        };

        try {
            const parsed = JSON.parse(trimmed);
            const fromJson = visit(parsed);
            if (fromJson) return fromJson;
        } catch {}

        const regexMatch = trimmed.match(/wss:\/\/[^"\s]+/i);
        return regexMatch ? regexMatch[0] : null;
    }

    private async handleRealtimeEvent(
      event: any,
      session: VapiRealtimeSession,
      callbacks: VapiRealtimeCallbacks
    ) {
        const type = event?.type;
        switch (type) {
            case "response.audio.delta": {
                const audio = event.audio ?? event.delta ?? event.data;
                if (audio) callbacks.onAudio(audio);
                break;
            }
            case "response.output_text.delta": {
                const text = event.text ?? event.delta;
                if (text) callbacks.onText?.(text);
                break;
            }
            case "response.message.delta": {
                const text = event.delta?.text ?? event.message?.content ?? event.message?.text;
                if (text) callbacks.onText?.(text);
                break;
            }
            case "response.completed": {
                callbacks.onToolStatus?.("response-completed");
                break;
            }
            case "response.tool_call":
            case "tool.call":
            case "session.tool_call": {
                const toolCall = this.normalizeToolCall(event);
                if (toolCall) await this.executeToolCall(toolCall, session, callbacks);
                break;
            }
            default: {
                if (event?.tool_calls && Array.isArray(event.tool_calls)) {
                    for (const raw of event.tool_calls) {
                        const toolCall = this.normalizeToolCall(raw);
                        if (toolCall) await this.executeToolCall(toolCall, session, callbacks);
                    }
                }
                break;
            }
        }
    }

    private normalizeToolCall(raw: any): NormalizedToolCall | null {
        if (!raw) return null;
        const container = raw.tool_call ?? raw.toolCall ?? raw.tool ?? raw;
        if (!container) return null;

        const id = container.id ?? container.tool_call_id ?? container.call_id ?? container.callId;
        const name =
          container.name ?? container.tool_name ?? container.function?.name ?? container.action;
        if (!id || !name) return null;

        let argsRaw =
          container.arguments ??
          container.input ??
          container.payload ??
          container.function?.arguments ??
          container.tool_arguments;

        if (typeof argsRaw === "string") {
            try {
                argsRaw = JSON.parse(argsRaw);
            } catch (error) {
                console.warn(`[VapiClient] Failed to parse tool arguments for ${name}:`, error);
                argsRaw = {};
            }
        }
        if (!argsRaw || typeof argsRaw !== "object") argsRaw = {};

        return { id, name, args: argsRaw as Record<string, unknown> };
    }

    private async executeToolCall(
      call: NormalizedToolCall,
      session: VapiRealtimeSession,
      callbacks: VapiRealtimeCallbacks
    ) {
        if (!this.company) {
            console.warn("[VapiClient] Company not configured; cannot execute tool call.");
            return;
        }

        if (!this.hasGoogleIntegration) {
            console.warn(`[VapiClient] Tool call '${call.name}' ignored because Google integration is disabled.`);
            session.sendToolResponse(call.id, { error: "Google integration not available" });
            return;
        }

        let toolResponse: Record<string, unknown> = {};

        try {
            if (call.name === "create_calendar_event") {
                const { summary, location, description, start, end, name, dateOfBirth } =
                  call.args as Record<string, string>;
                const event = {
                    summary,
                    location,
                    description: `Appointment for ${name} (DOB: ${dateOfBirth}). ${description ?? ""}`,
                    start: { dateTime: start, timeZone: "Europe/Amsterdam" },
                    end: { dateTime: end, timeZone: "Europe/Amsterdam" },
                    transparency: "opaque",
                    status: "confirmed",
                };
                await this.googleService.scheduleEvent(this.company.id, event);
                toolResponse = { success: true, event_summary: summary };
                callbacks.onToolStatus?.("calendar-event-created");
            } else if (call.name === "check_calendar_availability") {
                const { date } = call.args as Record<string, string>;
                const dayOfWeek = new Date(date).getDay();
                const hoursForDay = this.companyContext?.hours.find(
                  (h) => h.dayOfWeek === (dayOfWeek === 0 ? 7 : dayOfWeek)
                );

                let openHour = 9;
                let closeHour = 17;
                if (hoursForDay?.isOpen && hoursForDay.openTime && hoursForDay.closeTime) {
                    const [oH] = hoursForDay.openTime.split(":").map(Number);
                    const [cH] = hoursForDay.closeTime.split(":").map(Number);
                    openHour = oH;
                    closeHour = cH;
                }

                const availableSlots = await this.googleService.getAvailableSlots(
                  this.company.id,
                  date,
                  openHour,
                  closeHour
                );
                const summary = summarizeSlots(availableSlots, openHour, closeHour);
                toolResponse = { availableSlots, summary };
                callbacks.onToolStatus?.("calendar-availability-checked");
            } else if (call.name === "cancel_calendar_event") {
                const { name, dateOfBirth, eventId, reason } = call.args as Record<string, string>;
                const success = await this.googleService.cancelEvent(
                  this.company.id,
                  eventId,
                  name,
                  dateOfBirth
                );
                toolResponse = { success, reason };
                callbacks.onToolStatus?.("calendar-event-cancelled");
            } else {
                console.warn(`[VapiClient] Received unsupported tool call: ${call.name}`);
                toolResponse = { error: `Unsupported tool: ${call.name}` };
            }
        } catch (error) {
            console.error(`[VapiClient] Error executing tool '${call.name}':`, error);
            toolResponse = { error: (error as Error).message };
        }

        session.sendToolResponse(call.id, toolResponse);
    }

    /** ===== Assistant lifecycle ===== */
    public async createAssistantWithConfig(config?: VapiAssistantConfig): Promise<string> {
        const effectiveConfig = config ?? this.currentConfig;
        if (!effectiveConfig) {
            throw new Error("Company configuration must be set before creating a Vapi assistant");
        }

        const payload = this.buildAssistantPayload(effectiveConfig);
        const assistantId = await this.createAssistant(payload);
        this.assistantCache.set(effectiveConfig.company.id.toString(), assistantId);
        return assistantId;
    }

    public async updateAssistantWithConfig(
        assistantId: string,
        config?: VapiAssistantConfig
    ): Promise<void> {
        const effectiveConfig = config ?? this.currentConfig;
        if (!effectiveConfig) {
            throw new Error("Company configuration must be set before updating a Vapi assistant");
        }

        const payload = this.buildAssistantPayload(effectiveConfig);
        await this.updateAssistant(assistantId, payload);
        this.assistantCache.set(effectiveConfig.company.id.toString(), assistantId);
    }

    public async syncAssistant(config?: VapiAssistantConfig): Promise<string> {
        const effectiveConfig = config ?? this.currentConfig;
        if (!effectiveConfig) {
            throw new Error("Company configuration must be set before syncing a Vapi assistant");
        }

        const assistantName = this.getAssistantName(effectiveConfig);
        const cacheKey = effectiveConfig.company.id.toString();
        const payload = this.buildAssistantPayload(effectiveConfig);

        try {
            const cachedId = this.assistantCache.get(cacheKey);
            if (cachedId) {
                try {
                    await this.updateAssistant(cachedId, payload);
                    return cachedId;
                } catch (error) {
                    console.warn(
                      `[VapiClient] Cached assistant ${cachedId} for company ${assistantName} could not be updated; recreating.`,
                      error
                    );
                    this.assistantCache.delete(cacheKey);
                }
            }

            const existingId = await this.findAssistantIdByName(assistantName);
            if (existingId) {
                this.assistantCache.set(cacheKey, existingId);
                try {
                    await this.updateAssistant(existingId, payload);
                    return existingId;
                } catch (error) {
                    console.warn(
                      `[VapiClient] Existing assistant ${existingId} for company ${assistantName} could not be updated; creating new.`,
                      error
                    );
                }
            }

            const createdId = await this.createAssistant(payload);
            this.assistantCache.set(cacheKey, createdId);
            return createdId;
        } catch (error: unknown) {
            this.logAxiosError(
              `[VapiClient] Failed to sync assistant for company ${assistantName}`,
              error,
              payload
            );
            throw error;
        }
    }

    private buildAssistantPayload(config: VapiAssistantConfig) {
        const instructions = this.buildSystemPrompt(config);
        const companyContext = this.buildCompanySnapshot(config);
        const tools = this.getTools(config.hasGoogleIntegration);
        const modelMessages = this.buildModelMessages(instructions, companyContext, config);
        const modelTools = this.buildModelApiTools(config);

        const firstMessage = config.voiceSettings?.welcomePhrase?.trim();

        const voiceId = config.voiceSettings?.voiceId?.trim();
        const voice: { provider: string; voiceId?: string } = {
            provider: "11labs",
        };
        if (voiceId) {
            voice.voiceId = voiceId;
        }

        const payload: Record<string, unknown> = {
            name: this.getAssistantName(config),
            transcriber: {
                provider: "deepgram",
                language: "nl"
            },
            model: {
                provider: this.modelProvider,
                model: this.modelName,
                maxTokens: 10000,
                messages: modelMessages,
            },
            voice,
            firstMessageInterruptionsEnabled: false,
            firstMessageMode: "assistant-speaks-first",
            voicemailMessage: "sorry er is helaas niemand anders beschikbaar op het moment",
            endCallMessage: "Fijne dag!",
        };

        if (modelTools.length > 0) {
            (payload.model as Record<string, unknown>).tools = modelTools;
        }

        if (firstMessage) {
            payload.firstMessage = firstMessage;
        }

        return payload;
    }

    private getAssistantName(config: VapiAssistantConfig): string {
        const trimmed = config.company.name?.trim();
        return trimmed || config.company.id.toString();
    }

    private buildAssistantMetadata(
      config: VapiAssistantConfig,
      companyContext: CompanySnapshot,
      tools?: ReturnType<VapiClient["getTools"]>
    ) {
        const metadata: Record<string, unknown> = {
            companyId: companyContext.companyId,
            companyName: companyContext.companyName,
            googleCalendarEnabled: config.hasGoogleIntegration,
            companyContext: {
                ...companyContext,
                googleCalendarEnabled: config.hasGoogleIntegration,
            },
            replyStyle: {
                name: config.replyStyle.name,
                description: config.replyStyle.description,
            },
        };

        if (tools && tools.length > 0) {
            metadata.tools = tools;
        }

        if (config.voiceSettings) {
            const voiceMetadata: Record<string, unknown> = {};
            const trimmedVoiceId = config.voiceSettings.voiceId?.trim();
            const welcomePhrase = config.voiceSettings.welcomePhrase?.trim();

            if (trimmedVoiceId) {
                voiceMetadata.voiceId = trimmedVoiceId;
            }

            if (config.voiceSettings.talkingSpeed !== null &&
                config.voiceSettings.talkingSpeed !== undefined) {
                voiceMetadata.talkingSpeed = config.voiceSettings.talkingSpeed;
            }

            if (welcomePhrase) {
                voiceMetadata.welcomePhrase = welcomePhrase;
            }

            if (Object.keys(voiceMetadata).length > 0) {
                metadata.voiceSettings = voiceMetadata;
            }
        }

        return metadata;
    }

    private async findAssistantIdByName(name: string): Promise<string | null> {
        try {
            const response = await this.http.get(this.buildApiPath("/assistant"), {
                params: { name },
            });
            const assistants = this.extractAssistants(response.data);
            const assistant = assistants.find(
              (item: any) => item?.name === name || item?.assistant?.name === name
            );
            if (!assistant) return null;
            const container = assistant.assistant ?? assistant;
            return container.id ?? container._id ?? null;
        } catch (error) {
            this.logAxiosError(`[VapiClient] Failed to find assistant '${name}'`, error, undefined, "warn");
            return null;
        }
    }

    private async createAssistant(payload: Record<string, unknown>): Promise<string> {
        try {
            const response = await this.http.post(this.buildApiPath("/assistant"), payload);
            const data = response.data;
            const assistant = data?.assistant ?? data?.data ?? data;
            const id = assistant?.id ?? assistant?._id;
            if (!id) {
                throw new Error("Vapi create assistant response did not include an id");
            }
            return id;
        } catch (error) {
            this.logAxiosError("[VapiClient] Failed to create assistant", error, payload);
            throw error;
        }
    }

    private async updateAssistant(id: string, payload: Record<string, unknown>): Promise<void> {
        try {
            await this.http.patch(this.buildApiPath(`/assistant/${id}`), payload);
        } catch (error) {
            this.logAxiosError(`[VapiClient] Failed to update assistant ${id}`, error, payload);
            throw error;
        }
    }

    private extractAssistants(data: any): any[] {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.data)) return data.data;
        if (Array.isArray(data.assistants)) return data.assistants;
        if (Array.isArray(data.items)) return data.items;
        return [];
    }

    private logAxiosError(
      context: string,
      error: unknown,
      payload?: unknown,
      level: "error" | "warn" = "error"
    ) {
        if (axios.isAxiosError(error)) {
            const { method, url, data } = error.config ?? {};
            const response = error.response;
            const status = response?.status;
            const statusText = response?.statusText;
            const responseData = response?.data;
            const requestId =
                response?.headers?.["x-request-id"] ||
                response?.headers?.["x-requestid"] ||
                response?.headers?.["x-amzn-trace-id"];

            const logger = level === "warn" ? console.warn : console.error;
            const normalizePayload = (value: unknown) => {
                if (typeof value !== "string") return value;
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            };

            logger(context, {
                status,
                statusText,
                requestId,
                method,
                url,
                requestData: normalizePayload(data ?? payload),
                responseData: normalizePayload(responseData),
            });
        } else {
            const logger = level === "warn" ? console.warn : console.error;
            logger(context, error);
        }
    }
}

export type { VapiRealtimeSession };
