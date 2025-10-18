// src/clients/VapiClient.ts
import axios, { AxiosInstance } from 'axios';
import WebSocket, { RawData } from 'ws';
import { inject, injectable } from 'tsyringe';
import { CompanyModel } from '../business/models/CompanyModel';
import { ReplyStyleModel } from '../business/models/ReplyStyleModel';
import { CompanyInfoModel } from '../business/models/CompanyInfoModel';
import { CompanyDetailsModel } from '../business/models/CompanyDetailsModel';
import { CompanyHourModel } from '../business/models/CompanyHourModel';
import { CompanyContactModel } from '../business/models/CompanyContactModel';
import { AppointmentTypeModel } from '../business/models/AppointmentTypeModel';
import { StaffMemberModel } from '../business/models/StaffMemberModel';
import { VoiceSettingModel } from '../business/models/VoiceSettingsModel';
import type { calendar_v3 } from 'googleapis';
import { GoogleService } from '../business/services/GoogleService';

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
    skills?: string[];
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
  onTransferCall?: (
    payload: {
      phoneNumber?: string | null;
      callSid?: string | null;
      callerId?: string | null;
      reason?: string | null;
    },
  ) => Promise<{ transferredTo?: string | null; callSid?: string | null } | void>;
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

const PAYLOAD_LOG_LIMIT = 8000;

const logPayload = (label: string, payload: unknown, limit = PAYLOAD_LOG_LIMIT) => {
  try {
    const serialized = JSON.stringify(payload, null, 2);
    if (!serialized) {
      console.log(`${label}: <empty>`);
      return;
    }

    if (serialized.length <= limit) {
      console.log(`${label}: ${serialized}`);
      return;
    }

    console.log(
      `${label} (truncated to ${limit} of ${serialized.length} chars): ${serialized.slice(0, limit)}…`,
    );
  } catch (error) {
    console.log(`${label} (stringify failed)`, { error, payload });
  }
};

const TOOL_NAMES = {
  transferCall: 'transfer_call',
  scheduleGoogleCalendarEvent: 'schedule_google_calendar_event',
  checkGoogleCalendarAvailability: 'check_google_calendar_availability',
  cancelGoogleCalendarEvent: 'cancel_google_calendar_event',
} as const;

const LEGACY_TOOL_ALIASES = new Map<string, (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]>([
  ['create_calendar_event', TOOL_NAMES.scheduleGoogleCalendarEvent],
  ['check_calendar_availability', TOOL_NAMES.checkGoogleCalendarAvailability],
  ['cancel_calendar_event', TOOL_NAMES.cancelGoogleCalendarEvent],
]);

const KNOWN_TOOL_NAMES = new Set<(typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]>([
  TOOL_NAMES.transferCall,
  TOOL_NAMES.scheduleGoogleCalendarEvent,
  TOOL_NAMES.checkGoogleCalendarAvailability,
  TOOL_NAMES.cancelGoogleCalendarEvent,
]);

class VapiRealtimeSession {
  private closed = false;

  constructor(private readonly socket: WebSocket) {
  }

  public sendAudioChunkBinary(chunk: Buffer) {
    if (this.closed) return;
    if (!chunk?.length) return;
    this.socket.send(chunk);
  }

  public commitUserAudio() {
    // No-op: Vapi's websocket transport consumes raw binary frames only.
  }

  public sendToolResponse(toolCallId: string, payload: unknown) {
    if (this.closed) return;
    const output =
      typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});

    const message = {
      type: 'tool.response.create',
      tool_response: {
        tool_call_id: toolCallId,
        output,
      },
    };

    const messageKeys = Object.keys(message);
    console.log(`[VapiRealtimeSession] 📤 Outgoing message (${message.type})`, {
      toolCallId,
      messageKeys: messageKeys.join(', '),
      hasToolResponse: Boolean(message.tool_response),
      outputLength: typeof output === 'string' ? output.length : undefined,
    });

    logPayload(`[VapiRealtimeSession] 🧾 Tool response payload (${toolCallId})`, payload, PAYLOAD_LOG_LIMIT);
    logPayload(
      `[VapiRealtimeSession] 📨 Outgoing event payload (${message.type})`,
      message,
      PAYLOAD_LOG_LIMIT,
    );

    this.socket.send(JSON.stringify(message));
  }

  public close(code?: number, reason?: string) {
    if (this.closed) return;
    console.log(`[VapiRealtimeSession] Closing websocket with code ${code} and reason ${reason}`);
    this.closed = true;
    try {
      this.socket.close(code, reason);
    } catch (error) {
      console.error('[VapiRealtimeSession] Failed to close socket', error);
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
  private readonly transportProvider: string;
  private readonly sessionContexts = new WeakMap<
    VapiRealtimeSession,
    { callSid: string; callerNumber: string | null }
  >();
  private readonly sessionConfigs = new Map<string, VapiAssistantConfig>();
  private currentConfig: VapiAssistantConfig | null = null;

  constructor(@inject(GoogleService) private readonly googleService: GoogleService) {
    this.apiKey = process.env.VAPI_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[VapiClient] VAPI_API_KEY is not set. Requests to Vapi will fail.');
    }

    const apiBaseUrl = process.env.VAPI_API_BASE_URL || 'https://api.vapi.ai';
    this.apiPathPrefix = this.normalizePathPrefix(process.env.VAPI_API_PATH_PREFIX ?? '');
    this.modelProvider = process.env.VAPI_MODEL_PROVIDER || 'openai';
    this.modelName = process.env.VAPI_MODEL_NAME || 'gpt-4o-mini';
    this.transportProvider = 'vapi.websocket';

    this.toolBaseUrl = (process.env.SERVER_URL || 'https://api.voiceagent.stite.nl').replace(/\/$/, '');

    this.http = axios.create({
      baseURL: apiBaseUrl,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  private normalizePathPrefix(prefix: string): string {
    if (!prefix) return '';
    const trimmed = prefix.trim();
    if (!trimmed) return '';
    return trimmed.replace(/^\/+|\/+$|\s+/g, '');
  }

  private buildApiPath(path: string): string {
    if (!path.startsWith('/')) {
      throw new Error(`[VapiClient] API paths must start with '/'. Received: ${path}`);
    }
    const normalizedPath = path.replace(/^\/+/, '');
    const segments = [this.apiPathPrefix, normalizedPath].filter((s) => s.length > 0);
    return `/${segments.join('/')}`;
  }

  public setCompanyInfo(
    callSid: string,
    company: CompanyModel,
    hasGoogleIntegration: boolean,
    replyStyle: ReplyStyleModel,
    context: CompanyContext,
    schedulingContext: SchedulingContext,
    voiceSettings: VoiceSettingModel,
  ) {
    const config: VapiAssistantConfig = {
      company,
      hasGoogleIntegration,
      replyStyle,
      companyContext: context,
      schedulingContext,
      voiceSettings,
    };

    this.sessionConfigs.set(callSid, config);
    this.currentConfig = config;

    if (company.assistantId) {
      this.assistantCache.set(company.id.toString(), company.assistantId);
    }
  }

  public clearSessionConfig(callSid: string) {
    this.sessionConfigs.delete(callSid);
  }

  private getConfigForCall(callSid: string | null | undefined): VapiAssistantConfig | null {
    if (!callSid) {
      return this.currentConfig;
    }
    return this.sessionConfigs.get(callSid) ?? this.currentConfig;
  }

  public buildSystemPrompt(config?: VapiAssistantConfig): string {
    const effectiveConfig = config ?? this.currentConfig;
    if (!effectiveConfig) {
      throw new Error(
        'Company info, reply style, context, and scheduling context must be set before generating a system prompt.',
      );
    }

    const instructions: string[] = [
      `Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '${effectiveConfig.company.name}'. ${effectiveConfig.replyStyle.description}`,
      'Praat natuurlijk en menselijk en help de beller snel verder.',
      `Zorg dat je de juiste datum van vandaag gebruikt. Vermijd numerieke datum- en tijdnotatie (zoals 'dd-mm-jj' of '10:00'); gebruik natuurlijke taal, bijvoorbeeld 'tien uur' of '14 augustus 2025'.`,
      'Gebruik altijd de onderstaande bedrijfscontext. Als je informatie niet zeker weet of ontbreekt, communiceer dit dan duidelijk en bied alternatieve hulp aan.',
      'Als je een vraag niet kunt beantwoorden of een verzoek niet zelf kunt afhandelen, bied dan proactief aan om de beller door te verbinden met een medewerker.',
    ];

    if (effectiveConfig.hasGoogleIntegration) {
      instructions.push(
        `Je hebt toegang tot de Google Agenda van het bedrijf. Gebruik altijd eerst de tool '${TOOL_NAMES.checkGoogleCalendarAvailability}' voordat je een tijdstip voorstelt en vraag om naam en email voordat je '${TOOL_NAMES.scheduleGoogleCalendarEvent}' of '${TOOL_NAMES.cancelGoogleCalendarEvent}' gebruikt. Vraag altijd expliciet of de afspraak definitief ingepland mag worden en herhaal de email voor confirmatie`,
      );
    } else {
      instructions.push(
        'Je hebt geen toegang tot een agenda. Wanneer iemand een afspraak wil plannen, bied dan aan om een bericht door te geven of om de beller met een medewerker te verbinden.',
      );
    }

    instructions.push(
      'Gebruik de tool \'transfer_call\' zodra de beller aangeeft te willen worden doorverbonden. Gebruik altijd het algemene bedrijfsnummer',
    );

    return instructions.join('\n\n');
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
      'Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag',
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
        const trimmedName = typeof appointment.name === 'string'
          ? appointment.name.trim()
          : '';

        const entry: { name: string; durationMinutes?: number } = {
          name: trimmedName || appointment.name || '',
        };

        if (typeof appointment.duration === 'number') {
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
          skills?: string[];
          availability?: { day: string; ranges: string[] }[];
        } = {
          name: staff.name,
        };

        if (staff.role) {
          result.role = staff.role;
        }

        const specialties = (staff.specialties ?? [])
          .map((specialty) => specialty.name.trim())
          .filter((name) => name.length > 0);
        if (specialties.length > 0) {
          result.skills = specialties.slice(0, 5);
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
    const enabled = Boolean(hasGoogleIntegration);

    const tools: any[] = [
      {
        type: 'function',
        function: {
          name: TOOL_NAMES.transferCall,
          description:
            'Verbind de beller door naar een medewerker of collega wanneer menselijke hulp nodig is.',
          parameters: {
            type: 'object',
            properties: {
              phoneNumber: {
                type: 'string',
                description: `Vereist: het telefoonnummer om de beller naartoe door te verbinden (gebruik altijd het algemene bedrijfsnummer).`,
              },
              callSid: {
                type: 'string',
                description: 'Optioneel: het huidige callSid als je dit weet.',
              },
            },
            required: ['phoneNumber'],
          },
        },
      },
    ];

    if (!enabled) {
      return tools;
    }

    const createCalendarParameters = {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Titel van de afspraak' },
        location: { type: 'string', description: 'Locatie van de afspraak' },
        description: { type: 'string', description: 'Aanvullende details' },
        start: { type: 'string', description: 'Start in ISO 8601 (bijv. 2025-07-21T10:00:00+02:00)' },
        end: { type: 'string', description: 'Einde in ISO 8601' },
        name: { type: 'string', description: 'Volledige naam van de klant' },
        attendeeEmail: { type: 'string', description: 'E-mailadres van de klant' },
        dateOfBirth: { type: 'string', description: 'Geboortedatum DD-MM-YYYY' },
      },
      required: ['summary', 'start', 'end', 'name', 'dateOfBirth'],
    };

    const checkAvailabilityParameters = {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Datum (YYYY-MM-DD) om te controleren' },
      },
      required: ['date'],
    };

    const cancelCalendarParameters = {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID van het te annuleren event' },
        name: { type: 'string', description: 'Naam van de klant (verificatie)' },
        dateOfBirth: { type: 'string', description: 'Geboortedatum DD-MM-YYYY (verificatie)' },
        reason: { type: 'string', description: 'Reden van annulering' },
      },
      required: ['eventId', 'name', 'dateOfBirth'],
    };

    tools.push(
      {
        type: 'function',
        function: {
          name: TOOL_NAMES.scheduleGoogleCalendarEvent,
          description:
            'Maak een nieuw event in Google Agenda. Vraag eerst datum/tijd; daarna naam en telefoonnummer ter verificatie.',
          parameters: createCalendarParameters,
        },
      },
      {
        type: 'function',
        function: {
          name: TOOL_NAMES.checkGoogleCalendarAvailability,
          description:
            'Controleer beschikbare tijdsloten in Google Agenda voor een opgegeven datum.',
          parameters: checkAvailabilityParameters,
        },
      },
      {
        type: 'function',
        function: {
          name: TOOL_NAMES.cancelGoogleCalendarEvent,
          description:
            'Annuleer een bestaand event in Google Agenda na verificatie met telefoonnummer.',
          parameters: cancelCalendarParameters,
        },
      },
    );

    return tools;
  }

  private buildModelMessages(
    instructions: string,
    companyContext: CompanySnapshot,
    config: VapiAssistantConfig,
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
      '',
      'Bedrijfscontext (JSON):',
      JSON.stringify(contextPayload, null, 2),
    ]
      .filter((part) => part.length > 0)
      .join('\n');

    return [
      {
        role: 'system',
        content: messageContent,
      },
    ];
  }

  // Deprecated: kept for reference in case API tools are reintroduced.
  private buildModelApiTools_NOT_USED(_config: VapiAssistantConfig) {
    return [];
  }

  public async openRealtimeSession(
    callSid: string,
    callbacks: VapiRealtimeCallbacks,
    options?: { callerNumber?: string | null },
  ): Promise<{ session: VapiRealtimeSession; callId: string | null }> {
    const config = this.getConfigForCall(callSid);
    if (!config) {
      throw new Error('Company must be configured before opening a Vapi session');
    }

    const assistantId =
      config.company?.assistantId ??
      this.assistantCache.get(config.company.id.toString()) ??
      (await this.findAssistantIdByName(this.getAssistantName(config))) ??
      null;

    if (!assistantId) {
      throw new Error(`[Vapi] No assistant found for company '${this.getAssistantName(config)}'. Create/update it first via the admin endpoint.`);
    }

    const { primaryUrl, fallbackUrls, callId } = await this.createWebsocketCall(
      assistantId,
      callSid,
    );

    const candidates = [primaryUrl, ...fallbackUrls].filter((url, index, arr) =>
      typeof url === 'string' && url.startsWith('ws') && arr.indexOf(url) === index,
    );

    if (candidates.length === 0) {
      throw new Error('Vapi did not return a websocket URL for the realtime session');
    }

    const { socket: ws, url: connectedUrl } = await this.establishRealtimeSocket(
      candidates,
      callSid,
    );

    console.log(
      `[${callSid}] [Vapi] realtime session opened via ${connectedUrl}` +
      (callId ? ` (callId=${callId})` : ''),
    );

    const session = new VapiRealtimeSession(ws);
    this.sessionContexts.set(session, {
      callSid,
      callerNumber: options?.callerNumber ?? null,
    });

    const keepAlive = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        ws.ping();
      } catch (error) {
        console.warn(`[${callSid}] [Vapi] Failed to send websocket ping`, error);
      }
    }, 15000);

    ws.on('message', async (raw, isBinary) => {
      if (isBinary) {
        const buffer = this.normalizeBinaryAudioFrame(raw);
        if (buffer?.length && callbacks.onAudio) {
          callbacks.onAudio(buffer.toString('base64'));
        }
        return;
      }

      const s = typeof raw === 'string' ? raw : raw.toString('utf8');
      if (!s.trim().startsWith('{') && !s.trim().startsWith('[')) return;

      try {
        await this.handleRealtimeEvent(JSON.parse(s), session, callbacks);
      } catch (e) {
        console.error(`[${callSid}] [Vapi] Bad JSON frame`, s.slice(0, 120), e);
      }
    });

    ws.on('close', (code) => {
      console.log(`[${callSid}] [Vapi] realtime session closed with code ${code}`);
      clearInterval(keepAlive);
      callbacks.onSessionClosed?.();
      this.sessionContexts.delete(session);
      this.clearSessionConfig(callSid);
    });

    ws.on('error', (error) => {
      console.error(`[${callSid}] [Vapi] realtime session error`, error);
      callbacks.onSessionError?.(error as Error);
      this.sessionContexts.delete(session);
      this.clearSessionConfig(callSid);
    });

    return { session, callId: callId ?? null };
  }

  private async establishRealtimeSocket(
    candidateUrls: string[],
    callSid: string,
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
            `[${callSid}] [Vapi] websocket redirected from ${url} to ${finalUrl}`,
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
          `[${callSid}] [Vapi] Failed to open realtime socket at ${url}: ${err.message}`,
        );
      }
    }

    const aggregate = new Error(
      `Unable to establish Vapi realtime connection after ${candidateUrls.length} attempts.`,
    );
    (aggregate as any).causes = errors;
    throw aggregate;
  }

  private async createWebsocketCall(
    assistantId: string,
    _callSid: string,
  ): Promise<{ primaryUrl: string; fallbackUrls: string[]; callId?: string | null }> {

    const transport = {
      provider: this.transportProvider, // "vapi.websocket"
      audioFormat: {
        format: 'mulaw',
        container: 'raw',
        sampleRate: 8000,
      },
    };

    // ⬇️ Minimal payload, nothing else
    const payload = { assistantId, transport };

    const response = await this.http.post(this.buildApiPath('/call'), payload);
    const info = this.extractWebsocketCallInfo(response.data);
    if (!info) throw new Error('Vapi create call response did not include a websocket URL');
    return info;
  }


  private extractWebsocketCallInfo(
    data: any,
  ): { primaryUrl: string; fallbackUrls: string[]; callId?: string | null } | null {
    if (!data) return null;

    // Explicit, no recursion.
    const primaryUrl =
      data?.transport?.websocketCallUrl ??
      data?.websocketCallUrl ??
      data?.url ??
      null;

    if (!primaryUrl || typeof primaryUrl !== 'string' || !primaryUrl.startsWith('ws')) {
      return null;
    }

    // If Vapi ever adds fallbacks, pick them up here (otherwise empty).
    const fallbackUrls = Array.isArray(data?.transport?.fallbackUrls)
      ? data.transport.fallbackUrls.filter((u: any) => typeof u === 'string' && u.startsWith('ws'))
      : [];

    // ✅ The Vapi Call ID is just data.id
    const callId = (typeof data?.id === 'string' ? data.id : null) ?? null;

    return { primaryUrl, fallbackUrls, callId };
  }

  private async connectRealtimeSocket(
    url: string,
    callSid: string,
    visited: Set<string>,
  ): Promise<{ socket: WebSocket; finalUrl: string }> {
    if (visited.has(url)) {
      throw new Error(
        `[${callSid}] [Vapi] Realtime handshake loop detected when revisiting ${url}`,
      );
    }
    visited.add(url);

    return new Promise<{ socket: WebSocket; finalUrl: string }>((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      let settled = false;

      const cleanup = () => {
        socket.removeListener('open', onOpen);
        socket.removeListener('error', onError);
        socket.removeListener('unexpected-response', onUnexpectedResponse);
      };

      const swallowHandshakeError = (err: Error) => {
        console.warn(
          `[${callSid}] [Vapi] realtime socket error after unexpected response: ${err.message}`,
        );
      };

      const safeShutdown = (action: () => void) => {
        socket.once('error', swallowHandshakeError);
        socket.once('close', () => {
          socket.removeListener('error', swallowHandshakeError);
        });
        try {
          action();
        } catch {
        }
      };

      const finalizeWithError = (message: string, body: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        safeShutdown(() => socket.close());
        reject(new Error(message + (body ? ` – ${body}` : '')));
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
            `[${callSid}] [Vapi] Unexpected realtime handshake response ${statusCode ?? 'unknown'}` +
            (statusMessage ? ` ${statusMessage}` : '') +
            ` while connecting to ${url}. Trying fallback websocket ${fallbackUrl}`,
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
          const body = Buffer.concat(chunks).toString('utf8');

          if (attemptFallback(body)) {
            return;
          }

          const message =
            `[${callSid}] Unexpected realtime handshake response ${statusCode ?? 'unknown'}` +
            (statusMessage ? ` ${statusMessage}` : '');

          finalizeWithError(message, body);
        };

        res?.on('data', (chunk: Buffer) => chunks.push(chunk));
        res?.on('end', finalize);
        res?.on('close', finalize);
        res?.on('error', finalize);
      };

      socket.once('open', onOpen);
      socket.once('error', onError);
      socket.once('unexpected-response', onUnexpectedResponse);
    });
  }

  private extractRealtimeUrlFromBody(body: string): string | null {
    if (!body) return null;
    const trimmed = body.trim();
    if (!trimmed) return null;

    const visit = (value: unknown): string | null => {
      if (typeof value === 'string') {
        return value.startsWith('wss://') ? value : null;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          const found = visit(item);
          if (found) return found;
        }
      } else if (value && typeof value === 'object') {
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
    } catch {
    }

    const regexMatch = trimmed.match(/wss:\/\/[^"\s]+/i);
    return regexMatch ? regexMatch[0] : null;
  }

  private async handleRealtimeEvent(
    event: any,
    session: VapiRealtimeSession,
    callbacks: VapiRealtimeCallbacks,
  ) {
    const type = event?.type;

    const toolCallEventTypes = new Set([
      'response.tool_call',
      'tool.call',
      'session.tool_call',
      'tool_calls',
      'function_call',
    ]);

    const eventKeys = Object.keys(event || {});
    const hasToolCallsArray = Array.isArray(event?.tool_calls);
    const hasSingleToolCall = Boolean(
      event?.tool_call ?? event?.toolCall ?? event?.tool ?? event?.function,
    );
    const isToolCallEventType = toolCallEventTypes.has(type);
    const toolCallCount = hasToolCallsArray
      ? event.tool_calls.length
      : hasSingleToolCall
        ? 1
        : 0;

    const conversationEntries = Array.isArray(event?.conversation)
      ? (event.conversation as any[])
      : [];
    const messagesEntries = Array.isArray(event?.messages)
      ? (event.messages as any[])
      : [];

    const containsToolConversation = conversationEntries.some((item: any) => {
      const role = item?.role;
      return role === 'tool' || role === 'tool_call_result' || role === 'tool_calls';
    });

    const containsToolMessages = messagesEntries.some((item: any) => {
      const role = item?.role;
      return role === 'tool' || role === 'tool_call_result' || role === 'tool_calls';
    });

    const shouldLogToolEvent =
      isToolCallEventType ||
      hasToolCallsArray ||
      hasSingleToolCall ||
      containsToolConversation ||
      containsToolMessages;

    if (shouldLogToolEvent) {
      console.log(`[VapiClient] 📨 Tool event (${type ?? 'unknown'})`, {
        eventKeys: eventKeys.join(', '),
        isToolCallEventType,
        hasToolCallsArray,
        hasSingleToolCall,
        containsToolConversation,
        containsToolMessages,
        toolCallCount,
      });

      logPayload(`[VapiClient] 🧾 Tool event payload (${type ?? 'unknown'})`, event);

      const rawToolCalls: unknown[] = [];
      if (hasToolCallsArray) {
        rawToolCalls.push(...event.tool_calls);
      }

      for (const candidate of [event?.tool_call, event?.toolCall, event?.tool, event?.function]) {
        if (candidate && !rawToolCalls.includes(candidate)) {
          rawToolCalls.push(candidate);
        }
      }

      if (rawToolCalls.length > 0) {
        const payloadSummaries = rawToolCalls.map((payload, index) => ({
          index,
          keys: payload && typeof payload === 'object' ? Object.keys(payload as Record<string, unknown>) : [],
          payload,
        }));

        console.log(
          `[VapiClient] 🧰 Tool call payload details (${rawToolCalls.length})`,
          payloadSummaries,
        );
      }

      const toolResults = [...conversationEntries, ...messagesEntries].filter((item: any) => {
        const role = item?.role;
        return role === 'tool' || role === 'tool_call_result';
      });

      if (toolResults.length > 0) {
        console.log(`[VapiClient] 📦 Tool call results (${toolResults.length})`, toolResults);

        const noResultEntries = toolResults.filter((item: any) => {
          const content = typeof item?.content === 'string' ? item.content : null;
          const result = typeof item?.result === 'string' ? item.result : null;
          return content === 'No result returned.' || result === 'No result returned.';
        });

        if (noResultEntries.length > 0) {
          console.warn(
            `[VapiClient] ⚠️ Tool call returned no result (${noResultEntries.length})`,
            noResultEntries,
          );
        }
      }
    }

    switch (type) {
      case 'response.audio.delta': {
        const audio = event.audio ?? event.delta ?? event.data;
        if (audio) callbacks.onAudio(audio);
        break;
      }
      case 'response.output_text.delta': {
        const text = event.text ?? event.delta;
        if (text) callbacks.onText?.(text);
        break;
      }
      case 'response.message.delta': {
        const text = event.delta?.text ?? event.message?.content ?? event.message?.text;
        if (text) callbacks.onText?.(text);
        break;
      }
      case 'response.completed': {
        callbacks.onToolStatus?.('response-completed');
        break;
      }
      case 'response.tool_call':
      case 'tool.call':
      case 'session.tool_call':
      case 'tool_calls':
      case 'function_call': {
        console.log(`[VapiClient] 🔧 Tool call event detected!`);
        const toolCall = this.normalizeToolCall(event);
        if (toolCall) {
          console.log(`[VapiClient] ✅ Normalized tool call:`, toolCall);
          await this.executeToolCall(toolCall, session, callbacks);
        } else {
          console.warn(
            `[VapiClient] ❌ Failed to normalize tool call. Raw event:`,
            JSON.stringify(event, null, 2),
          );
        }
        break;
      }
      default: {
        if (event?.tool_calls && Array.isArray(event.tool_calls)) {
          console.log(
            `[VapiClient] 🔧 Found tool_calls array (${event.tool_calls.length} items)`,
          );
          for (const raw of event.tool_calls) {
            const toolCall = this.normalizeToolCall(raw);
            if (toolCall) {
              console.log(`[VapiClient] ✅ Normalized tool call from array:`, toolCall);
              await this.executeToolCall(toolCall, session, callbacks);
            } else {
              console.warn(
                `[VapiClient] ❌ Failed to normalize tool call from array:`,
                JSON.stringify(raw, null, 2),
              );
            }
          }
        }
        break;
      }
    }
  }

  private normalizeBinaryAudioFrame(data: RawData): Buffer | null {
    if (!data) return null;

    if (Buffer.isBuffer(data)) {
      return data;
    }

    if (Array.isArray(data)) {
      const buffers = data
        .map((item) => this.normalizeBinaryAudioFrame(item as RawData))
        .filter((value): value is Buffer => Boolean(value));
      return buffers.length ? Buffer.concat(buffers) : null;
    }

    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }

    return null;
  }

  private normalizeToolCall(raw: any): NormalizedToolCall | null {
    if (!raw) {
      console.warn(`[VapiClient] normalizeToolCall received null/undefined`);
      return null;
    }

    console.log(
      `[VapiClient] 🔍 Normalizing tool call. Raw keys:`,
      Object.keys(raw).join(', '),
    );

    // Handle nested function structure: { id, type, function: { name, arguments } }
    let container = raw;
    if (raw.function && typeof raw.function === 'object') {
      // Extract ID from top level, but name/args from nested function
      const id =
        raw.id ??
        raw.tool_call_id ??
        raw.call_id ??
        raw.callId ??
        `tool_${Date.now()}`;

      const name = raw.function.name ?? raw.function.function_name;
      let argsRaw = raw.function.arguments ?? raw.function.input;

      console.log(`[VapiClient] 🔍 Found nested function structure - ID: ${id}, Name: ${name}`);

      if (!name) {
        console.warn(
          `[VapiClient] ❌ No tool name found in nested function. Raw:`,
          JSON.stringify(raw, null, 2),
        );
        return null;
      }

      // Parse arguments if string
      if (typeof argsRaw === 'string') {
        console.log(`[VapiClient] 🔍 Arguments is string, parsing...`);
        try {
          argsRaw = JSON.parse(argsRaw);
          console.log(`[VapiClient] ✅ Parsed arguments:`, argsRaw);
        } catch (error) {
          console.error(`[VapiClient] ❌ Failed to parse arguments string:`, argsRaw);
          argsRaw = {};
        }
      }

      if (!argsRaw || typeof argsRaw !== 'object') {
        console.log(`[VapiClient] ⚠️ No valid arguments found, using empty object`);
        argsRaw = {};
      }

      const result = {
        id,
        name,
        args: argsRaw as Record<string, unknown>,
      };

      console.log(`[VapiClient] ✅ Successfully normalized nested function call:`, result);
      return result;
    }

    // Fallback to original flat structure handling
    container = raw.tool_call ?? raw.toolCall ?? raw.tool ?? raw;

    if (!container) {
      console.warn(`[VapiClient] No container found in raw tool call`);
      return null;
    }

    const id =
      container.id ??
      container.tool_call_id ??
      container.call_id ??
      container.callId ??
      container.function_call_id ??
      `tool_${Date.now()}`;

    const name =
      container.name ??
      container.tool_name ??
      container.function?.name ??
      container.action ??
      container.function_name;

    console.log(`[VapiClient] 🔍 Extracted - ID: ${id}, Name: ${name}`);

    if (!name) {
      console.warn(
        `[VapiClient] ❌ No tool name found. Container:`,
        JSON.stringify(container, null, 2),
      );
      return null;
    }

    let argsRaw =
      container.arguments ??
      container.input ??
      container.payload ??
      container.parameters ??
      container.function?.arguments ??
      container.tool_arguments ??
      container.args;

    if (typeof argsRaw === 'string') {
      console.log(`[VapiClient] 🔍 Arguments is string, parsing...`);
      try {
        argsRaw = JSON.parse(argsRaw);
        console.log(`[VapiClient] ✅ Parsed arguments:`, argsRaw);
      } catch (error) {
        console.error(`[VapiClient] ❌ Failed to parse arguments string:`, argsRaw);
        argsRaw = {};
      }
    }

    if (!argsRaw || typeof argsRaw !== 'object') {
      console.log(`[VapiClient] ⚠️ No valid arguments found, using empty object`);
      argsRaw = {};
    }

    const result = {
      id,
      name,
      args: argsRaw as Record<string, unknown>,
    };

    console.log(`[VapiClient] ✅ Successfully normalized tool call:`, result);
    return result;
  }

  private async executeToolCall(
    call: NormalizedToolCall,
    session: VapiRealtimeSession,
    callbacks: VapiRealtimeCallbacks,
  ) {
    console.log(`[VapiClient] 🔧 === EXECUTING TOOL CALL ===`);
    console.log(`[VapiClient] Tool ID: ${call.id}`);
    console.log(`[VapiClient] Tool Name: ${call.name}`);
    console.log(`[VapiClient] Tool Args:`, JSON.stringify(call.args, null, 2));

    const normalizedToolName = this.normalizeToolName(call.name);
    console.log(`[VapiClient] Normalized name: ${normalizedToolName}`);

    const googleTools = new Set<(typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]>([
      TOOL_NAMES.scheduleGoogleCalendarEvent,
      TOOL_NAMES.checkGoogleCalendarAvailability,
      TOOL_NAMES.cancelGoogleCalendarEvent,
    ]);

    const sessionContext = this.sessionContexts.get(session);
    const config = this.getConfigForCall(sessionContext?.callSid);

    if (!config) {
      console.error('[VapiClient] ❌ No config found for session');
      session.sendToolResponse(call.id, {
        success: false,
        error: 'Session not configured',
      });
      return;
    }

    console.log(
      `[VapiClient] Config found - Company: ${config.company.name}, Google: ${config.hasGoogleIntegration}`,
    );

    if (normalizedToolName && googleTools.has(normalizedToolName) && !config.hasGoogleIntegration) {
      console.warn(`[VapiClient] ⚠️ Google tool called but integration disabled`);
      session.sendToolResponse(call.id, {
        success: false,
        error: 'Google integration not available',
      });
      return;
    }

    const sendSuccess = (data: unknown) => {
      const payload = { success: true, data };
      console.log(`[VapiClient] ✅ Tool response payload`, {
        toolCallId: call.id,
        payload,
      });
      session.sendToolResponse(call.id, payload);
    };

    const sendError = (message: string, details?: unknown) => {
      const payload = {
        success: false,
        error: message,
        details,
      };
      console.error(`[VapiClient] ❌ Tool response payload`, {
        toolCallId: call.id,
        payload,
      });
      session.sendToolResponse(call.id, payload);
    };

    const companyId = config.company.id;
    const args = call.args ?? {};

    const handlers: Record<string, () => Promise<void>> = {
      [TOOL_NAMES.transferCall]: async () => {
        console.log(`[VapiClient] 📞 === TRANSFER CALL ===`);

        if (!callbacks.onTransferCall) {
          throw new Error('Doorverbinden is niet beschikbaar in deze sessie.');
        }

        const phoneNumber = this.normalizeStringArg(args['phoneNumber']);
        const sessionCallSid = sessionContext?.callSid ?? null;
        const callSidFromArgs = this.normalizeStringArg(args['callSid']);
        const callSid = callSidFromArgs ?? sessionCallSid;
        const callerId = this.normalizeStringArg(args['callerId']);
        const reason = this.normalizeStringArg(args['reason']);

        console.log(`[VapiClient] Transfer params - Phone: ${phoneNumber}, CallSid: ${callSid}`);

        const result = await callbacks.onTransferCall({ phoneNumber, callSid, callerId, reason });

        sendSuccess({
          message: 'Doorverbinden gestart',
          transferredTo: result?.transferredTo ?? phoneNumber ?? null,
          callSid: result?.callSid ?? callSid ?? sessionCallSid ?? null,
          reason: reason ?? null,
        });
      },
      [TOOL_NAMES.checkGoogleCalendarAvailability]: async () => {
        console.log(`[VapiClient] 📅 === CHECK CALENDAR AVAILABILITY ===`);

        const date = this.normalizeStringArg(args['date']);
        console.log(`[VapiClient] Requested date: ${date}`);
        console.log(`[VapiClient] All args:`, args);

        if (!date) {
          throw new Error('Ontbrekende datum voor agenda beschikbaarheid.');
        }

        console.log(`[VapiClient] Getting business hours for date...`);
        const { openHour, closeHour } = this.getBusinessHoursForDate(config, date);
        console.log(`[VapiClient] Business hours: ${openHour}:00 - ${closeHour}:00`);

        console.log(
          `[VapiClient] Calling GoogleService.getAvailableSlots(${companyId}, ${date}, ${openHour}, ${closeHour})...`,
        );

        try {
          const slots = await this.googleService.getAvailableSlots(companyId, date, openHour, closeHour);
          console.log(`[VapiClient] ✅ Received ${slots?.length || 0} slots:`, slots);

          sendSuccess({
            date,
            openHour,
            closeHour,
            slots,
            message: `Found ${slots?.length || 0} available time slots`,
          });
        } catch (error) {
          console.error(`[VapiClient] ❌ Error getting slots:`, error);
          throw error;
        }
      },
      [TOOL_NAMES.scheduleGoogleCalendarEvent]: async () => {
        console.log(`[VapiClient] 📝 === SCHEDULE CALENDAR EVENT ===`);

        const summary = this.normalizeStringArg(args['summary']);
        const start = this.normalizeStringArg(args['start']);
        const end = this.normalizeStringArg(args['end']);
        const name = this.normalizeStringArg(args['name']);
        const description = this.normalizeStringArg(args['description']);
        const location = this.normalizeStringArg(args['location']);
        const attendeeEmail = this.normalizeStringArg(args['attendeeEmail']);
        const dateOfBirth = this.normalizeStringArg(args['dateOfBirth']);
        const callerNumber = sessionContext?.callerNumber ?? null;

        console.log(`[VapiClient] Event params:`, {
          summary,
          start,
          end,
          name,
          dateOfBirth,
          callerNumber,
        });

        if (!summary || !start || !end || !name || !dateOfBirth) {
          throw new Error('Ontbrekende verplichte velden voor het maken van een agenda item.');
        }

        const details: string[] = [];
        if (description) details.push(description);
        details.push(`Naam: ${name}`);
        details.push(`Geboortedatum: ${dateOfBirth}`);
        if (callerNumber) details.push(`Telefoonnummer: ${callerNumber}`);
        const compiledDescription = details.join('\n');

        const event: calendar_v3.Schema$Event = {
          summary,
          description: compiledDescription,
          location: location ?? undefined,
          start: { dateTime: start },
          end: { dateTime: end },
        };

        if (attendeeEmail) {
          event.attendees = [{ email: attendeeEmail, displayName: name }];
        }

        const privateProperties: Record<string, string> = {
          customerName: name,
          customerDateOfBirth: dateOfBirth,
        };

        if (callerNumber) {
          privateProperties.customerPhoneNumber = callerNumber;
        }

        event.extendedProperties = { private: privateProperties };

        console.log(`[VapiClient] Creating event in calendar...`);
        const created = await this.googleService.scheduleEvent(companyId, event);
        console.log(`[VapiClient] ✅ Event created:`, created.id);

        sendSuccess({ event: created });
      },
      [TOOL_NAMES.cancelGoogleCalendarEvent]: async () => {
        console.log(`[VapiClient] 🗑️ === CANCEL CALENDAR EVENT ===`);

        const eventId = this.normalizeStringArg(args['eventId']);
        const name = this.normalizeStringArg(args['name']);
        const dateOfBirth = this.normalizeStringArg(args['dateOfBirth']);
        const reason = this.normalizeStringArg(args['reason']);

        console.log(`[VapiClient] Cancel params:`, { eventId, name, dateOfBirth, reason });

        if (!eventId) {
          throw new Error('Ontbreekt eventId om te annuleren.');
        }

        console.log(`[VapiClient] Calling GoogleService.cancelEvent...`);
        await this.googleService.cancelEvent(
          companyId,
          eventId,
          name ?? undefined,
          dateOfBirth ?? undefined,
        );
        console.log(`[VapiClient] ✅ Event cancelled`);

        sendSuccess({
          eventId,
          cancelled: true,
          reason: reason ?? null,
        });
      },
    };

    const handler = normalizedToolName ? handlers[normalizedToolName] : undefined;

    if (!handler) {
      console.error(`[VapiClient] ❌ No handler found!`);
      console.error(`[VapiClient] Looking for: ${normalizedToolName}`);
      console.error(`[VapiClient] Available handlers:`, Object.keys(handlers));
      sendError(`Onbekende tool: ${call.name}`);
      return;
    }

    console.log(`[VapiClient] 🎯 Handler found, executing...`);

    try {
      await handler();
      console.log(`[VapiClient] ✅ Handler completed successfully`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message || `Onbekende fout bij uitvoeren van ${call.name}`
          : `Onbekende fout bij uitvoeren van ${call.name}`;
      console.error(`[VapiClient] ❌ Handler threw error:`, error);
      sendError(message);
    }
  }

  private normalizeToolName(name: string): (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES] | null {
    const normalized = this.normalizeStringArg(name)?.toLowerCase();
    if (!normalized) {
      return null;
    }

    const alias = LEGACY_TOOL_ALIASES.get(normalized);
    if (alias) {
      return alias;
    }

    return KNOWN_TOOL_NAMES.has(normalized as (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES])
      ? (normalized as (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES])
      : null;
  }

  private normalizeStringArg(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  }

  private getBusinessHoursForDate(
    config: VapiAssistantConfig,
    date: string,
  ): { openHour: number; closeHour: number } {
    const defaultHours = { openHour: 9, closeHour: 17 };

    if (!config.companyContext?.hours || config.companyContext.hours.length === 0) {
      return defaultHours;
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error('Ongeldige datum voor agenda beschikbaarheid.');
    }

    const dayOfWeek = parsedDate.getDay();
    const entry = config.companyContext.hours.find((hour) => hour.dayOfWeek === dayOfWeek);
    if (!entry) {
      return defaultHours;
    }

    if (!entry.isOpen) {
      throw new Error('Het bedrijf is gesloten op de gevraagde datum.');
    }

    const openHour = this.parseHour(entry.openTime) ?? defaultHours.openHour;
    const closeHour = this.parseHour(entry.closeTime) ?? defaultHours.closeHour;

    if (closeHour <= openHour) {
      throw new Error('Ongeldige openingstijden voor de gevraagde datum.');
    }

    return { openHour, closeHour };
  }

  private parseHour(value: string | null | undefined): number | null {
    if (!value) return null;
    const match = value.match(/^(\d{1,2})(?::\d{2})?$/);
    if (!match) return null;
    const hour = Number.parseInt(match[1], 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return null;
    return hour;
  }

  /** ===== Assistant lifecycle ===== */
  public async createAssistantWithConfig(config?: VapiAssistantConfig): Promise<string> {
    const effectiveConfig = config ?? this.currentConfig;
    if (!effectiveConfig) {
      throw new Error('Company configuration must be set before creating a Vapi assistant');
    }

    const payload = this.buildAssistantPayload(effectiveConfig);
    const assistantId = await this.createAssistant(payload);
    this.assistantCache.set(effectiveConfig.company.id.toString(), assistantId);
    return assistantId;
  }

  public async updateAssistantWithConfig(
    assistantId: string,
    config?: VapiAssistantConfig,
  ): Promise<void> {
    const effectiveConfig = config ?? this.currentConfig;
    if (!effectiveConfig) {
      throw new Error('Company configuration must be set before updating a Vapi assistant');
    }

    const payload = this.buildAssistantPayload(effectiveConfig);
    this.assistantCache.delete(effectiveConfig.company.id.toString());
    await this.updateAssistant(assistantId, payload);
  }

  public async syncAssistant(config?: VapiAssistantConfig): Promise<string> {
    const effectiveConfig = config ?? this.currentConfig;
    if (!effectiveConfig) {
      throw new Error('Company configuration must be set before syncing a Vapi assistant');
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
            error,
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
            error,
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
        payload,
      );
      throw error;
    }
  }

  private buildAssistantPayload(config: VapiAssistantConfig) {
    const instructions = this.buildSystemPrompt(config);
    const companyContext = this.buildCompanySnapshot(config);

    const tools = this.getTools(config.hasGoogleIntegration);

    const modelMessages = this.buildModelMessages(instructions, companyContext, config);

    const payload: Record<string, unknown> = {
      name: this.getAssistantName(config),
      transcriber: { provider: 'deepgram', language: 'nl' },
      model: {
        provider: this.modelProvider,
        model: this.modelName,
        maxTokens: 10000,
        messages: modelMessages,
        tools,
      },
      firstMessageInterruptionsEnabled: false,
      firstMessageMode: 'assistant-speaks-first',
      voicemailMessage: 'sorry er is helaas niemand anders beschikbaar op het moment',
      endCallMessage: 'Fijne dag!',
    };

    const firstMessage = config.voiceSettings?.welcomePhrase?.trim();
    if (firstMessage) payload.firstMessage = firstMessage;

    const voiceId = config.voiceSettings?.voiceId?.trim();
    if (voiceId) payload.voice = { provider: '11labs', voiceId };

    return payload;
  }

  private getAssistantName(config: VapiAssistantConfig): string {
    const trimmed = config.company.name?.trim();
    return trimmed || config.company.id.toString();
  }

  private buildAssistantMetadata(
    config: VapiAssistantConfig,
    companyContext: CompanySnapshot,
    tools?: ReturnType<VapiClient['getTools']>,
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
      const response = await this.http.get(this.buildApiPath('/assistant'), {
        params: { name },
      });
      const assistants = this.extractAssistants(response.data);
      const assistant = assistants.find(
        (item: any) => item?.name === name || item?.assistant?.name === name,
      );
      if (!assistant) return null;
      const container = assistant.assistant ?? assistant;
      return container.id ?? container._id ?? null;
    } catch (error) {
      this.logAxiosError(`[VapiClient] Failed to find assistant '${name}'`, error, undefined, 'warn');
      return null;
    }
  }

  private async createAssistant(payload: Record<string, unknown>): Promise<string> {
    try {
      const response = await this.http.post(this.buildApiPath('/assistant'), payload);
      const data = response.data;
      const assistant = data?.assistant ?? data?.data ?? data;
      const id = assistant?.id ?? assistant?._id;
      if (!id) {
        throw new Error('Vapi create assistant response did not include an id');
      }
      return id;
    } catch (error) {
      this.logAxiosError('[VapiClient] Failed to create assistant', error, payload);
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
    level: 'error' | 'warn' = 'error',
  ) {
    if (axios.isAxiosError(error)) {
      const { method, url, data } = error.config ?? {};
      const response = error.response;
      const status = response?.status;
      const statusText = response?.statusText;
      const responseData = response?.data;
      const requestId =
        response?.headers?.['x-request-id'] ||
        response?.headers?.['x-requestid'] ||
        response?.headers?.['x-amzn-trace-id'];

      const logger = level === 'warn' ? console.warn : console.error;
      const normalizePayload = (value: unknown) => {
        if (typeof value !== 'string') return value;
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
      const logger = level === 'warn' ? console.warn : console.error;
      logger(context, error);
    }
  }

  public async fetchCallDetails(callId: string): Promise<any> {
    const normalized = (callId ?? '').toString().trim();
    if (!normalized) {
      throw new Error('A valid Vapi call ID is required to fetch call details.');
    }

    const path = this.buildApiPath(`/call/${encodeURIComponent(normalized)}`);
    const response = await this.http.get(path);
    return response.data;
  }
}

export type { VapiRealtimeSession };
