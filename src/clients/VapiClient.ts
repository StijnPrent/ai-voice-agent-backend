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

class VapiRealtimeSession {
  private closed = false;

  constructor(private readonly socket: WebSocket) {}

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
    this.socket.send(
      JSON.stringify({
        type: 'tool.response.create',
        tool_response: {
          tool_call_id: toolCallId,
          output:
            typeof payload === 'string'
              ? payload
              : JSON.stringify(payload ?? {}),
        },
      }),
    );
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

  private company: CompanyModel | null = null;
  private hasGoogleIntegration = false;
  private replyStyle: ReplyStyleModel | null = null;
  private companyContext: CompanyContext | null = null;
  private schedulingContext: SchedulingContext | null = null;
  private voiceSettings: VoiceSettingModel | null = null;
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
    company: CompanyModel,
    hasGoogleIntegration: boolean,
    replyStyle: ReplyStyleModel,
    context: CompanyContext,
    schedulingContext: SchedulingContext,
    voiceSettings: VoiceSettingModel,
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

    if (effectiveConfig.voiceSettings?.welcomePhrase) {
      instructions.push(
        `Start elk gesprek vriendelijk met de welkomstboodschap: "${effectiveConfig.voiceSettings.welcomePhrase}".`,
      );
    }

    if (effectiveConfig.hasGoogleIntegration) {
      instructions.push(
        'Je hebt toegang tot de Google Agenda van het bedrijf. Gebruik altijd eerst de tool \'check_calendar_availability\' voordat je een tijdstip voorstelt en vraag om naam en email voordat je \'create_calendar_event\' of \'cancel_calendar_event\' gebruikt. Vraag altijd expliciet of de afspraak definitief ingepland mag worden en herhaal de email voor confirmatie',
      );
    } else {
      instructions.push(
        'Je hebt geen toegang tot een agenda. Wanneer iemand een afspraak wil plannen, bied dan aan om een bericht door te geven of om de beller met een medewerker te verbinden.',
      );
    }

    instructions.push(
      "Gebruik de tool 'transfer_call' zodra de beller aangeeft te willen worden doorverbonden. Voeg een korte reden toe en gebruik bij voorkeur het algemene bedrijfsnummer uit de context, tenzij de beller een ander nummer opgeeft.",
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
    const enabled = hasGoogleIntegration ?? this.hasGoogleIntegration;

    const tools: any[] = [
      {
        type: 'function',
        name: 'transfer_call',
        description:
          'Verbind de beller door naar een medewerker of collega wanneer menselijke hulp nodig is.',
        parameters: {
          type: 'object',
          properties: {
            phoneNumber: {
              type: 'string',
              description: 'Telefoonnummer of SIP-adres van de medewerker die de call moet overnemen.',
            },
            callSid: {
              type: 'string',
              description: 'Optioneel: het huidige callSid als je dit weet.',
            },
            reason: {
              type: 'string',
              description: 'Korte toelichting waarom er wordt doorverbonden.',
            },
          },
          required: ['phoneNumber'],
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
        name: 'create_calendar_event',
        description:
          'Maak een nieuw event in Google Agenda. Vraag eerst datum/tijd; daarna naam en telefoonnummer ter verificatie.',
        parameters: createCalendarParameters,
      },
      {
        type: 'function',
        name: 'check_calendar_availability',
        description:
          'Controleer beschikbare tijdsloten in Google Agenda voor een opgegeven datum.',
        parameters: checkAvailabilityParameters,
      },
      {
        type: 'function',
        name: 'cancel_calendar_event',
        description:
          'Annuleer een bestaand event in Google Agenda na verificatie met telefoonnummer.',
        parameters: cancelCalendarParameters,
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

  private buildModelApiTools(config: VapiAssistantConfig) {
    if (!this.toolBaseUrl?.startsWith('https://')) {
      console.warn('[VapiClient] Skipping apiRequest tools: VAPI_TOOL_BASE_URL must be https.');
      return [];
    }

    const join = (p: string) => `${this.toolBaseUrl}${p.startsWith('/') ? p : `/${p}`}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (process.env.INTERNAL_API_KEY) {
      headers['x-internal-api-key'] = process.env.INTERNAL_API_KEY!;
    }

    const createApiRequestTool = (
      name: string,
      description: string,
      path: string,
      jsonSchema: Record<string, unknown>,
    ) => ({
      type: 'apiRequest',
      name,
      description,
      method: 'POST',
      url: join(path),
      headers,
      timeoutSeconds: 15,
      body: {
        type: 'jsonSchema',
        jsonSchema,
      },
    });

    const tools: any[] = [
      createApiRequestTool(
        'transfer_call',
        'Verbind de beller door naar een medewerker via het opgegeven telefoonnummer.',
        '/voice/transfer',
        {
          type: 'object',
          properties: {
            phoneNumber: {
              type: 'string',
              description: 'Bestemmingsnummer in E.164-formaat waarvoor moet worden doorgeschakeld.',
            },
            callSid: {
              type: 'string',
              description: 'Het actieve callSid zodat het gesprek kan worden bijgehouden.',
            },
            callerId: {
              type: 'string',
              description: 'Caller ID dat moet worden meegegeven tijdens het doorverbinden.',
            },
            reason: {
              type: 'string',
              description: 'Korte toelichting waarom de beller moet worden doorgeschakeld.',
            },
          },
          required: ['phoneNumber', 'callSid', 'callerId', 'reason'],
          additionalProperties: false,
        },
      ),
    ];

    if (config.hasGoogleIntegration) {
      tools.push(
        createApiRequestTool(
          'check_google_calendar_availability',
          'Controleer beschikbare Google Agenda tijdsloten voor een opgegeven datum.',
          '/google/availability',
          {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                format: 'date',
                description: 'Datum (YYYY-MM-DD) waarvoor beschikbaarheid moet worden opgehaald.',
              },
            },
            required: ['date'],
            additionalProperties: false,
          },
        ),
        createApiRequestTool(
          'schedule_google_calendar_event',
          'Plan een nieuwe Google Agenda-afspraak voor de beller met alle details.',
          '/google/schedule',
          {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'Korte titel van de afspraak.',
              },
              start: {
                type: 'string',
                format: 'date-time',
                description: 'Starttijd in ISO 8601-formaat inclusief tijdzone.',
              },
              end: {
                type: 'string',
                format: 'date-time',
                description: 'Eindtijd in ISO 8601-formaat inclusief tijdzone.',
              },
              name: {
                type: 'string',
                description: 'Volledige naam van de klant.',
              },
              dateOfBirth: {
                type: 'string',
                format: 'date',
                description: 'Geboortedatum van de klant (YYYY-MM-DD).',
              },
              description: {
                type: 'string',
                description: 'Optionele toelichting die bij de afspraak moet worden opgeslagen.',
              },
              location: {
                type: 'string',
                description: 'Optionele locatie van de afspraak.',
              },
              attendeeEmail: {
                type: 'string',
                format: 'email',
                description: 'Optioneel e-mailadres van de aanwezige.',
              },
            },
            required: ['summary', 'start', 'end', 'name', 'dateOfBirth'],
            additionalProperties: false,
          },
        ),
        createApiRequestTool(
          'cancel_google_calendar_event',
          'Annuleer een bestaande Google Agenda-afspraak en registreer de reden van annuleren.',
          '/google/cancel',
          {
            type: 'object',
            properties: {
              eventId: {
                type: 'string',
                description: 'Unieke ID van de afspraak die moet worden geannuleerd.',
              },
              name: {
                type: 'string',
                description: 'Naam van de persoon voor wie de afspraak staat.',
              },
              dateOfBirth: {
                type: 'string',
                format: 'date',
                description: 'Geboortedatum van de persoon (YYYY-MM-DD).',
              },
              reason: {
                type: 'string',
                description: 'Reden van annulering die moet worden vastgelegd.',
              },
            },
            required: ['eventId', 'name', 'dateOfBirth', 'reason'],
            additionalProperties: false,
          },
        ),
      );
    }

    return tools;
  }

  public async openRealtimeSession(
    callSid: string,
    callbacks: VapiRealtimeCallbacks,
  ): Promise<{ session: VapiRealtimeSession; callId: string | null }> {
    const config = this.currentConfig;
    if (!config || !this.company || !this.replyStyle || !this.companyContext || !this.schedulingContext) {
      throw new Error('Company must be configured before opening a Vapi session');
    }

    const assistantId =
      this.company?.assistantId ??
      this.assistantCache.get(this.company!.id.toString()) ??
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
    });

    ws.on('error', (error) => {
      console.error(`[${callSid}] [Vapi] realtime session error`, error);
      callbacks.onSessionError?.(error as Error);
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

    if (!primaryUrl || typeof primaryUrl !== "string" || !primaryUrl.startsWith("ws")) {
      return null;
    }

    // If Vapi ever adds fallbacks, pick them up here (otherwise empty).
    const fallbackUrls = Array.isArray(data?.transport?.fallbackUrls)
      ? data.transport.fallbackUrls.filter((u: any) => typeof u === "string" && u.startsWith("ws"))
      : [];

    // ✅ The Vapi Call ID is just data.id
    const callId = (typeof data?.id === "string" ? data.id : null) ?? null;

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
      case 'session.tool_call': {
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

    if (typeof argsRaw === 'string') {
      try {
        argsRaw = JSON.parse(argsRaw);
      } catch (error) {
        console.warn(`[VapiClient] Failed to parse tool arguments for ${name}:`, error);
        argsRaw = {};
      }
    }
    if (!argsRaw || typeof argsRaw !== 'object') argsRaw = {};

    return { id, name, args: argsRaw as Record<string, unknown> };
  }

  private async executeToolCall(
    call: NormalizedToolCall,
    session: VapiRealtimeSession,
    callbacks: VapiRealtimeCallbacks,
  ) {
    if (!this.company) {
      console.warn('[VapiClient] Company not configured; cannot execute tool call.');
      return;
    }

    const googleTools = new Set([
      'create_calendar_event',
      'check_calendar_availability',
      'cancel_calendar_event',
    ]);

    if (googleTools.has(call.name) && !this.hasGoogleIntegration) {
      console.warn(`[VapiClient] Tool call '${call.name}' ignored because Google integration is disabled.`);
      session.sendToolResponse(call.id, { error: 'Google integration not available' });
      return;
    }

    const sendSuccess = (data: unknown) => {
      session.sendToolResponse(call.id, { success: true, data });
    };

    const sendError = (message: string, details?: unknown) => {
      session.sendToolResponse(call.id, {
        success: false,
        error: message,
        details,
      });
    };

    const companyId = this.company.id;

    const args = call.args ?? {};

    const handlers: Record<string, () => Promise<void>> = {
      transfer_call: async () => {
        if (!callbacks.onTransferCall) {
          throw new Error('Doorverbinden is niet beschikbaar in deze sessie.');
        }

        const phoneNumber = this.normalizeStringArg(args['phoneNumber']);
        const callSid = this.normalizeStringArg(args['callSid']);
        const callerId = this.normalizeStringArg(args['callerId']);
        const reason = this.normalizeStringArg(args['reason']);

        const result = await callbacks.onTransferCall({ phoneNumber, callSid, callerId, reason });

        sendSuccess({
          message: 'Doorverbinden gestart',
          transferredTo: result?.transferredTo ?? phoneNumber ?? null,
          callSid: result?.callSid ?? callSid ?? null,
          reason: reason ?? null,
        });
      },
      check_calendar_availability: async () => {
        const date = this.normalizeStringArg(args['date']);
        if (!date) {
          throw new Error('Ontbrekende datum voor agenda beschikbaarheid.');
        }

        const { openHour, closeHour } = this.getBusinessHoursForDate(date);

        const slots = await this.googleService.getAvailableSlots(companyId, date, openHour, closeHour);
        sendSuccess({ date, openHour, closeHour, slots });
      },
      create_calendar_event: async () => {
        const summary = this.normalizeStringArg(args['summary']);
        const start = this.normalizeStringArg(args['start']);
        const end = this.normalizeStringArg(args['end']);
        const name = this.normalizeStringArg(args['name']);
        const description = this.normalizeStringArg(args['description']);
        const location = this.normalizeStringArg(args['location']);
        const attendeeEmail = this.normalizeStringArg(args['attendeeEmail']);
        const dateOfBirth = this.normalizeStringArg(args['dateOfBirth']);

        if (!summary || !start || !end || !name || !dateOfBirth) {
          throw new Error('Ontbrekende verplichte velden voor het maken van een agenda item.');
        }

        const details: string[] = [];
        if (description) details.push(description);
        details.push(`Naam: ${name}`);
        details.push(`Geboortedatum: ${dateOfBirth}`);
        const compiledDescription = details.join('\n');

        const event: calendar_v3.Schema$Event = {
          summary,
          description: compiledDescription,
          location: location ?? undefined,
          start: { dateTime: start },
          end: { dateTime: end },
        };

        if (attendeeEmail) {
          event.attendees = [
            {
              email: attendeeEmail,
              displayName: name,
            },
          ];
        }

        event.extendedProperties = {
          private: {
            customerName: name,
            customerDateOfBirth: dateOfBirth,
          },
        };

        const created = await this.googleService.scheduleEvent(companyId, event);
        sendSuccess({ event: created });
      },
      cancel_calendar_event: async () => {
        const eventId = this.normalizeStringArg(args['eventId']);
        const name = this.normalizeStringArg(args['name']);
        const dateOfBirth = this.normalizeStringArg(args['dateOfBirth']);
        const reason = this.normalizeStringArg(args['reason']);

        if (!eventId) {
          throw new Error('Ontbreekt eventId om te annuleren.');
        }

        await this.googleService.cancelEvent(companyId, eventId, name ?? undefined, dateOfBirth ?? undefined);
        sendSuccess({
          eventId,
          cancelled: true,
          reason: reason ?? null,
        });
      },
    };

    const handler = handlers[call.name];

    if (!handler) {
      sendError(`Onbekende tool: ${call.name}`);
      return;
    }

    try {
      await handler();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message || `Onbekende fout bij uitvoeren van ${call.name}`
          : `Onbekende fout bij uitvoeren van ${call.name}`;
      console.error(`[VapiClient] Error executing tool '${call.name}':`, error);
      sendError(message);
    }
  }

  private normalizeStringArg(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  }

  private getBusinessHoursForDate(date: string): { openHour: number; closeHour: number } {
    const defaultHours = { openHour: 9, closeHour: 17 };

    if (!this.companyContext?.hours || this.companyContext.hours.length === 0) {
      return defaultHours;
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new Error('Ongeldige datum voor agenda beschikbaarheid.');
    }

    const dayOfWeek = parsedDate.getDay();
    const entry = this.companyContext.hours.find((hour) => hour.dayOfWeek === dayOfWeek);
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
    const modelTools = this.buildModelApiTools(config);

    const firstMessage = config.voiceSettings?.welcomePhrase?.trim();

    const voiceId = config.voiceSettings?.voiceId?.trim();
    let voice: { provider: string; voiceId?: string; modelId?: string; language?: string } | undefined;
    if (voiceId) {
      voice = {
        provider: '11labs',
        voiceId,
        language: 'nl',
      };
    }

    const payload: Record<string, unknown> = {
      name: this.getAssistantName(config),
      transcriber: { provider: 'deepgram', language: 'nl' },
      model: {
        provider: this.modelProvider,
        model: this.modelName,
        maxTokens: 10000,
        messages: modelMessages,
      },
      firstMessageInterruptionsEnabled: false,
      firstMessageMode: 'assistant-speaks-first',
      voicemailMessage: 'sorry er is helaas niemand anders beschikbaar op het moment',
      endCallMessage: 'Fijne dag!',
    };

    if (modelTools.length > 0) {
      (payload.model as Record<string, unknown>).tools = modelTools;
    }
    if (firstMessage) payload.firstMessage = firstMessage;
    if (voice) payload.voice = voice;

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
