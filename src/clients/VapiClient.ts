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
                    output: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}),
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
    private readonly realtimeBaseUrl: string;
    private readonly http: AxiosInstance;
    private readonly assistantCache = new Map<string, string>();

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

        this.realtimeBaseUrl = process.env.VAPI_REALTIME_URL || "wss://api.vapi.ai/v1/realtime";
        const apiBaseUrl = process.env.VAPI_API_BASE_URL || "https://api.vapi.ai";
        this.http = axios.create({
            baseURL: apiBaseUrl,
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            timeout: 15000,
        });
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
    }

    public buildSystemPrompt(config?: VapiAssistantConfig): string {
        const effectiveConfig = config ?? this.currentConfig;
        if (!effectiveConfig) {
            throw new Error(
                "Company info, reply style, context, and scheduling context must be set before generating a system prompt."
            );
        }

        const { company, replyStyle, companyContext, schedulingContext, hasGoogleIntegration, voiceSettings } = effectiveConfig;
        const { details, contact, hours, info } = companyContext;
        const { appointmentTypes, staffMembers } = schedulingContext;

        const dayNames = [
            "Zondag",
            "Maandag",
            "Dinsdag",
            "Woensdag",
            "Donderdag",
            "Vrijdag",
            "Zaterdag",
        ];
        const getDayName = (index: number) => dayNames[((index % 7) + 7) % 7] ?? `Dag ${index}`;

        let prompt =
            `Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '${company.name}'. ${replyStyle.description}` +
            " je praat zo menselijk mogelijk" +
            ` het is vandaag ${new Date().toLocaleDateString('nl-NL', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            })}` +
            " Vermijd het gebruik van numerieke datum- en tijdnotatie (zoals 'dd-mm-jj', '14-08-25' of '10:00'). Schrijf tijden en datums altijd voluit in natuurlijke taal, bijvoorbeeld 'tien uur' en '14 augustus 2025'.";

        prompt += "Hier is wat informatie over het bedrijf:\n";

        if (details) {
            prompt += `\n**Bedrijfsdetails:**\n`;
            prompt += `- Naam: ${details.name}\n`;
            if (details.industry) prompt += `- Industrie: ${details.industry}\n`;
            if (details.description) prompt += `- Omschrijving: ${details.description}\n`;
        }

        if (contact) {
            prompt += `\n**Contactgegevens:**\n`;
            if (contact.website) prompt += `- Website: ${contact.website}\n`;
            if (contact.contact_email) prompt += `- E-mailadres: ${contact.contact_email}\n`;
            if (contact.phone) prompt += `- Telefoonnummer: ${contact.phone}\n`;
            if (contact.address) prompt += `- Adres: ${contact.address}\n`;
        }

        if (hours && hours.length > 0) {
            prompt += `\n**Openingstijden:**\n`;
            hours.forEach((hour) => {
                const day = getDayName(hour.dayOfWeek);
                if (hour.isOpen) {
                    prompt += `- ${day}: ${hour.openTime} - ${hour.closeTime}\n`;
                } else {
                    prompt += `- ${day}: Gesloten\n`;
                }
            });
        }

        if (info && info.length > 0) {
            prompt += "\n**Algemene Informatie:**\n";
            info.forEach((i) => {
                prompt += `- ${i.value}\n`;
            });
        }

        if (appointmentTypes && appointmentTypes.length > 0) {
            const MAX_APPOINTMENT_TYPES = 10;
            const limitedAppointments = appointmentTypes.slice(0, MAX_APPOINTMENT_TYPES);
            prompt += "\n**Soorten Afspraken:**\n";
            limitedAppointments.forEach((appointment) => {
                const durationLabel = appointment.duration ? ` (${appointment.duration} minuten)` : "";
                prompt += `- ${appointment.name}${durationLabel}\n`;
            });
            if (appointmentTypes.length > MAX_APPOINTMENT_TYPES) {
                prompt += `- ...en ${appointmentTypes.length - MAX_APPOINTMENT_TYPES} extra afspraaktypes beschikbaar.\n`;
            }
        }

        if (staffMembers && staffMembers.length > 0) {
            const MAX_STAFF_ENTRIES = 5;
            const limitedStaff = staffMembers.slice(0, MAX_STAFF_ENTRIES);
            prompt += "\n**Medewerkers en Beschikbaarheid:**\n";
            limitedStaff.forEach((staff) => {
                prompt += `- ${staff.name} (${staff.role})\n`;
                if (staff.availability && staff.availability.length > 0) {
                    const groupedByDay = new Map<number, string[]>();
                    staff.availability
                        .filter((avail) => avail.isActive && avail.startTime && avail.endTime)
                        .forEach((avail) => {
                            const slots = groupedByDay.get(avail.dayOfWeek) ?? [];
                            slots.push(`${avail.startTime} - ${avail.endTime}`);
                            groupedByDay.set(avail.dayOfWeek, slots);
                        });

                    const orderedDays = Array.from(groupedByDay.entries()).sort((a, b) => a[0] - b[0]);
                    for (const [dayOfWeek, ranges] of orderedDays) {
                        const day = getDayName(dayOfWeek);
                        prompt += `  - ${day}: ${ranges.join(", ")}\n`;
                    }
                }
            });

            if (staffMembers.length > MAX_STAFF_ENTRIES) {
                prompt += `  ...en ${staffMembers.length - MAX_STAFF_ENTRIES} extra medewerkers beschikbaar.\n`;
            }
        }

        prompt += "\n";

        if (voiceSettings?.welcomePhrase) {
            prompt += `\nStart elk gesprek vriendelijk met: \"${voiceSettings.welcomePhrase}\".`;
        }

        if (hasGoogleIntegration) {
            prompt += "BELANGRIJKE INSTRUCTIE: Je hebt toegang tot de Google Agenda van het bedrijf. Gebruik ALTIJD de 'check_calendar_availability' tool om te controleren op beschikbare tijden voordat je een afspraak voorstelt. Vraag de gebruiker om hun volledige naam en geboortedatum voor je de afspraak inplant met 'create_calendar_event'. Deze gegevens zijn nodig om de afspraak later te kunnen annuleren met 'cancel_calendar_event'. Vraag altijd om een expliciete bevestiging voordat je de afspraak definitief inplant.";
        } else {
            prompt += "BELANGRIJKE INSTRUCTIE: Je hebt GEEN toegang tot de agenda. Als een gebruiker een afspraak wil maken, informeer hen dan dat je dit niet automatisch kunt doen. Bied aan om een notitie achter te laten voor het team of om de gebruiker door te verbinden met een medewerker.";
        }

        return prompt;
    }

    public getTools(hasGoogleIntegration?: boolean) {
        const enabled = hasGoogleIntegration ?? this.hasGoogleIntegration;
        if (!enabled) {
            return [];
        }

        return [
            {
                type: "function",
                name: "create_calendar_event",
                description:
                    "Maak een nieuw evenement aan in de Google Agenda. Vraag eerst naar de datum en tijd en als er een datum en tijd en vastgesteld vraag dan naar de naam en geboortedatum van de klant.",
                input_schema: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "De titel van de afspraak" },
                        location: { type: "string", description: "De locatie van de afspraak" },
                        description: { type: "string", description: "Een beschrijving van de afspraak" },
                        start: { type: "string", description: "De starttijd in ISO 8601 formaat (e.g., 2025-07-21T10:00:00)" },
                        end: { type: "string", description: "De eindtijd in ISO 8601 formaat (e.g., 2025-07-21T11:00:00)" },
                        name: { type: "string", description: "De volledige naam van de klant" },
                        dateOfBirth: { type: "string", description: "De geboortedatum van de klant (DD-MM-YYYY)" },
                    },
                    required: ["summary", "start", "end", "name", "dateOfBirth"],
                },
            },
            {
                type: "function",
                name: "check_calendar_availability",
                description: "Controleer de beschikbaarheid in de agenda voor een specifieke datum.",
                input_schema: {
                    type: "object",
                    properties: {
                        date: { type: "string", description: "De datum om te controleren in YYYY-MM-DD formaat" },
                    },
                    required: ["date"],
                },
            },
            {
                type: "function",
                name: "cancel_calendar_event",
                description: "Annuleer een afspraak op basis van naam, geboortedatum en de datum van de afspraak.",
                input_schema: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "De volledige naam van de klant" },
                        dateOfBirth: { type: "string", description: "De geboortedatum van de klant (DD-MM-YYYY)" },
                        date: { type: "string", description: "De datum van de afspraak in YYYY-MM-DD formaat" },
                    },
                    required: ["name", "dateOfBirth", "date"],
                },
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
        const tools = this.getTools(config.hasGoogleIntegration);

        const ws = new WebSocket(`${this.realtimeBaseUrl}?assistantId=${assistantId}`, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
        });

        const session = new VapiRealtimeSession(ws);

        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => {
                console.log(`[${callSid}] [Vapi] realtime session opened.`);
                const updatePayload: any = {
                    type: "session.update",
                    session: {
                        instructions: prompt,
                        tools,
                        modalities: ["audio"],
                        input_audio_format: {
                            encoding: "mulaw",
                            sample_rate: 8000,
                        },
                        output_audio_format: {
                            encoding: "mulaw",
                            sample_rate: 8000,
                        },
                        voice: config.voiceSettings
                            ? {
                                  provider: "vapi",
                                  voice_id: config.voiceSettings.voiceId,
                                  speed: config.voiceSettings.talkingSpeed,
                              }
                            : undefined,
                        metadata: {
                            companyId: config.company.id,
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
                resolve();
            });

            ws.once("error", (err) => {
                console.error(`[${callSid}] [Vapi] realtime session error before open`, err);
                reject(err);
            });
        });

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

    private async handleRealtimeEvent(
        event: any,
        session: VapiRealtimeSession,
        callbacks: VapiRealtimeCallbacks
    ) {
        const type = event?.type;
        switch (type) {
            case "response.audio.delta": {
                const audio = event.audio ?? event.delta ?? event.data;
                if (audio) {
                    callbacks.onAudio(audio);
                }
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
                if (toolCall) {
                    await this.executeToolCall(toolCall, session, callbacks);
                }
                break;
            }
            default: {
                if (event?.tool_calls && Array.isArray(event.tool_calls)) {
                    for (const raw of event.tool_calls) {
                        const toolCall = this.normalizeToolCall(raw);
                        if (toolCall) {
                            await this.executeToolCall(toolCall, session, callbacks);
                        }
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
        const name = container.name ?? container.tool_name ?? container.function?.name ?? container.action;

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

        if (!argsRaw || typeof argsRaw !== "object") {
            argsRaw = {};
        }

        return {
            id,
            name,
            args: argsRaw as Record<string, unknown>,
        };
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
                const { summary, location, description, start, end, name, dateOfBirth } = call.args as Record<string, string>;
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
                const hoursForDay = this.companyContext?.hours.find((h) => h.dayOfWeek === (dayOfWeek === 0 ? 7 : dayOfWeek));

                let openHour = 9;
                let closeHour = 17;
                if (hoursForDay?.isOpen && hoursForDay.openTime && hoursForDay.closeTime) {
                    const [oH] = hoursForDay.openTime.split(":").map(Number);
                    const [cH] = hoursForDay.closeTime.split(":").map(Number);
                    openHour = oH;
                    closeHour = cH;
                }

                const availableSlots = await this.googleService.getAvailableSlots(this.company.id, date, openHour, closeHour);
                const summary = summarizeSlots(availableSlots, openHour, closeHour);
                toolResponse = { availableSlots, summary };
                callbacks.onToolStatus?.("calendar-availability-checked");
            } else if (call.name === "cancel_calendar_event") {
                const { name, dateOfBirth, date } = call.args as Record<string, string>;
                const success = await this.googleService.cancelEvent(this.company.id, name, dateOfBirth, date);
                toolResponse = { success };
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

    public async syncAssistant(config?: VapiAssistantConfig): Promise<string> {
        const effectiveConfig = config ?? this.currentConfig;
        if (!effectiveConfig) {
            throw new Error("Company configuration must be set before syncing a Vapi assistant");
        }

        const name = effectiveConfig.company.id.toString();
        const cacheKey = name;
        const payload = this.buildAssistantPayload(effectiveConfig);

        try {
            const cachedId = this.assistantCache.get(cacheKey);
            if (cachedId) {
                try {
                    await this.updateAssistant(cachedId, payload);
                    return cachedId;
                } catch (error) {
                    console.warn(`[VapiClient] Cached assistant ${cachedId} for company ${name} could not be updated; recreating.`, error);
                    this.assistantCache.delete(cacheKey);
                }
            }

            const existingId = await this.findAssistantIdByName(name);
            if (existingId) {
                this.assistantCache.set(cacheKey, existingId);
                try {
                    await this.updateAssistant(existingId, payload);
                    return existingId;
                } catch (error) {
                    console.warn(`[VapiClient] Existing assistant ${existingId} for company ${name} could not be updated; creating new.`, error);
                }
            }

            const createdId = await this.createAssistant(payload);
            this.assistantCache.set(cacheKey, createdId);
            return createdId;
        } catch (error) {
            console.error(`[VapiClient] Failed to sync assistant for company ${name}`, error);
            throw error;
        }
    }

    private buildAssistantPayload(config: VapiAssistantConfig) {
        const instructions = this.buildSystemPrompt(config);
        const tools = this.getTools(config.hasGoogleIntegration);
        const voice = config.voiceSettings
            ? {
                  provider: "vapi",
                  voice_id: config.voiceSettings.voiceId,
                  speed: config.voiceSettings.talkingSpeed,
              }
            : undefined;

        return {
            name: config.company.id.toString(),
            instructions,
            tools,
            voice,
            metadata: {
                companyId: config.company.id.toString(),
                companyName: config.company.name,
                googleCalendarEnabled: config.hasGoogleIntegration,
            },
            first_message: config.voiceSettings?.welcomePhrase ?? undefined,
            firstMessage: config.voiceSettings?.welcomePhrase ?? undefined,
            modalities: ["audio"],
        };
    }

    private async findAssistantIdByName(name: string): Promise<string | null> {
        try {
            const response = await this.http.get("/assistants", { params: { name } });
            const assistants = this.extractAssistants(response.data);
            const assistant = assistants.find((item: any) => item?.name === name || item?.assistant?.name === name);
            if (!assistant) return null;
            const container = assistant.assistant ?? assistant;
            return container.id ?? container._id ?? null;
        } catch (error) {
            console.warn(`[VapiClient] Failed to find assistant '${name}':`, error);
            return null;
        }
    }

    private async createAssistant(payload: Record<string, unknown>): Promise<string> {
        const response = await this.http.post("/assistants", payload);
        const assistant = response.data?.assistant ?? response.data?.data ?? response.data;
        const id = assistant?.id ?? assistant?._id;
        if (!id) {
            throw new Error("Vapi create assistant response did not include an id");
        }
        return id;
    }

    private async updateAssistant(id: string, payload: Record<string, unknown>): Promise<void> {
        await this.http.patch(`/assistants/${id}`, payload);
    }

    private extractAssistants(data: any): any[] {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.data)) return data.data;
        if (Array.isArray(data.assistants)) return data.assistants;
        if (Array.isArray(data.items)) return data.items;
        return [];
    }
}

export type { VapiRealtimeSession };
