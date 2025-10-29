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
import type { CalendarAvailability } from '../business/services/GoogleService';

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

type AvailableRange = {
  start: string;
  end: string;
  durationMinutes: number;
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

const formatDutchDate = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const formatted = formatter.format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};


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

  public sendJsonFrame(frame: Record<string, unknown>) {
    if (this.closed) return;

    try {
      const type = typeof (frame as any)?.type === 'string' ? (frame as any).type : 'unknown';
      logPayload(`[VapiRealtimeSession] ⇨ Sending JSON frame (${type})`, frame, PAYLOAD_LOG_LIMIT);
      const payload = JSON.stringify(frame);
      this.socket.send(payload);
    } catch (error) {
      console.error('[VapiRealtimeSession] Failed to send JSON frame', error, frame);
    }
  }

  public commitUserAudio() {
    if (this.closed) return;

    try {
      const frame = JSON.stringify({ type: 'input_audio_buffer.commit' });
      this.socket.send(frame);
    } catch (error) {
      console.error('[VapiRealtimeSession] Failed to commit user audio', error);
    }
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
  private readonly availabilityCache = new Map<
    string,
    { availability: CalendarAvailability; availableRanges: AvailableRange[]; expiresAt: number }
  >();
  private readonly availabilityPending = new Map<
    string,
    { promise: Promise<{ availability: CalendarAvailability; availableRanges: AvailableRange[] }>; startedAt: number }
  >();
  private readonly availabilityCacheTtlMs = 2 * 60 * 1000; // 2 minutes
  private readonly availabilityRequestTimeoutMs = 2500; // 2.5 seconds
  private readonly toolBaseUrl: string;
  private readonly transportProvider: string;
  private readonly sessionContexts = new WeakMap<
    VapiRealtimeSession,
    { callSid: string; callerNumber: string | null; callId: string | null }
  >();
  private readonly activeSessionsByCallId = new Map<
    string,
    { session: VapiRealtimeSession; callbacks: VapiRealtimeCallbacks; callSid: string }
  >();
  private readonly sessionConfigs = new Map<string, VapiAssistantConfig>();
  private readonly toolResponseLog = new Map<
    string,
    { timestamp: number; payload: unknown; normalizedName?: string | null }
  >();
  private currentConfig: VapiAssistantConfig | null = null;
  private toolResults = new Map<string, unknown>();

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

  // In VapiClient.ts
  public static formatToolLogContext(args: { callSid?: string | null; callId?: string | null }) {
    const parts: string[] = [];
    const sid = (args.callSid ?? '').trim();
    const cid = (args.callId ?? '').trim();
    if (sid) parts.push(`callSid=${sid}`);
    if (cid) parts.push(`callId=${cid}`);
    return parts.length ? `(${parts.join(', ')})` : '';
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

  private deriveAvailableRanges(availability: CalendarAvailability): AvailableRange[] {
    const { operatingWindow, busy } = availability;

    const windowStart = new Date(operatingWindow.start);
    const windowEnd = new Date(operatingWindow.end);

    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd.getTime() <= windowStart.getTime()) {
      return [];
    }

    const busyIntervals = busy
      .map((interval) => {
        const start = new Date(interval.start);
        const end = new Date(interval.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
          return null;
        }
        return { start, end };
      })
      .filter((interval): interval is { start: Date; end: Date } => interval !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const ranges: AvailableRange[] = [];
    let cursor = windowStart;

    for (const interval of busyIntervals) {
      if (interval.start.getTime() > cursor.getTime()) {
        const rangeStart = new Date(cursor.getTime());
        const rangeEnd = new Date(Math.min(interval.start.getTime(), windowEnd.getTime()));
        const durationMinutes = Math.max(0, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 60000));
        if (durationMinutes > 0) {
          ranges.push({
            start: rangeStart.toISOString(),
            end: rangeEnd.toISOString(),
            durationMinutes,
          });
        }
      }

      if (interval.end.getTime() > cursor.getTime()) {
        cursor = new Date(Math.min(interval.end.getTime(), windowEnd.getTime()));
      }

      if (cursor.getTime() >= windowEnd.getTime()) {
        break;
      }
    }

    if (cursor.getTime() < windowEnd.getTime()) {
      const rangeStart = new Date(cursor.getTime());
      const rangeEnd = windowEnd;
      const durationMinutes = Math.max(0, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 60000));
      if (durationMinutes > 0) {
        ranges.push({
          start: rangeStart.toISOString(),
          end: rangeEnd.toISOString(),
          durationMinutes,
        });
      }
    }

    return ranges;
  }

  public buildSystemPrompt(config?: VapiAssistantConfig): string {
    const effectiveConfig = config ?? this.currentConfig;
    if (!effectiveConfig) {
      throw new Error(
        'Company info, reply style, context, and scheduling context must be set before generating a system prompt.',
      );
    }

    const todayText = formatDutchDate(new Date());

    const instructions: string[] = [
      `Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '${effectiveConfig.company.name}'. ${effectiveConfig.replyStyle.description}`,
      'Praat natuurlijk en menselijk en help de beller snel verder.',
      'Vandaag is {{ "now" | date: "%A %d %B %Y", "Europe/Amsterdam" }}. Gebruik deze datum als referentiepunt voor alle afspraken en antwoorden.',
      `Zorg dat je de juiste datum van vandaag gebruikt. Vermijd numerieke datum- en tijdnotatie (zoals 'dd-mm-jj' of '10:00'); gebruik natuurlijke taal, bijvoorbeeld 'tien uur' of '14 augustus 2025'.`,
      'Vraag wanneer mensen naar beschikbaarheid vragen altijd eerst naar hun voorkeur voor een dag.',
      'Stel voorstellen voor afspraken menselijk voor door slechts relevante tijdsopties in natuurlijke taal te benoemen en niet alle tijdsloten op te sommen.',
      'Gebruik altijd de onderstaande bedrijfscontext. Als je informatie niet zeker weet of ontbreekt, communiceer dit dan duidelijk en bied alternatieve hulp aan.',
      'Als je een vraag niet kunt beantwoorden of een verzoek niet zelf kunt afhandelen, bied dan proactief aan om de beller door te verbinden met een medewerker.',
      'Wanneer je agenda-informatie deelt, benoem expliciet welke tijden al bezet zijn en welke blokken nog vrij zijn.',
      'Als een dag volledig vrij is, zeg duidelijk dat de hele dag beschikbaar is.',
      'Wanneer een beller blijft aandringen op een volledig volgeboekte dag, bied dan actief aan om de beller door te verbinden met een medewerker.',
      'Bevestig afspraken uitsluitend door de datum en tijd in natuurlijke taal te herhalen en voeg geen andere details toe.',
      'Gebruik geen standaardzinnetjes zoals "Wacht even" wanneer je een tool gebruikt; blijf natuurlijk of ga direct verder zonder extra melding.',
    ];

    if (effectiveConfig.hasGoogleIntegration) {
      instructions.push(
        `Je hebt toegang tot de Google Agenda van het bedrijf. Gebruik altijd eerst de tool '${TOOL_NAMES.checkGoogleCalendarAvailability}' voordat je een tijdstip voorstelt. Voor het inplannen gebruik je het telefoonnummer dat al bekend is in het systeem en vraag je alleen naar de naam van de beller voordat je '${TOOL_NAMES.scheduleGoogleCalendarEvent}' gebruikt. Voor annuleringen moet je zowel de naam als het telefoonnummer bevestigen en een telefoonnummer dat met '06' begint interpreteer je als '+316…'. Vraag altijd expliciet of de afspraak definitief ingepland mag worden en controleer vooraf of je de naam goed hebt begrepen, maar herhaal bij de definitieve bevestiging alleen de datum en tijd. Als hij succesvol is ingepland dan bevestig je het alleen door de datum en tijd in natuurlijke taal te herhalen zonder de locatie.`,
        `BELANGRIJK: Voor afspraken gebruik je de Google Agenda tools, NIET de transfer_call tool.`,
      );
    } else {
      instructions.push(
        'Je hebt geen toegang tot een agenda. Wanneer iemand een afspraak wil plannen, bied dan aan om een bericht door te geven of om de beller met een medewerker te verbinden. Vraag in dat geval alleen naar de naam van de beller.',
      );
    }

    instructions.push(
      'Gebruik de tool \'transfer_call\' zodra de beller aangeeft te willen worden doorverbonden. Gebruik altijd het standaard bedrijfsnummer.',
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
    console.log(`[VapiClient] 🔧 Building tools - Google integration enabled: ${enabled}`);

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
        server: {
          url: `${this.toolBaseUrl}/vapi/tools`,
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
        start: { type: 'string', description: 'Start in ISO 8601 (bijv. 2025-07-21T10:00:00+02:00)' },
        end: { type: 'string', description: 'Einde in ISO 8601' },
        name: { type: 'string', description: 'Volledige naam van de klant' },
        description: { type: 'string', description: 'Aanvullende details' },
        location: { type: 'string', description: 'Locatie van de afspraak' },
      },
      required: ['summary', 'start', 'end', 'name'],
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
        start: {
          type: 'string',
          description: 'Startdatum en -tijd (ISO 8601) van de afspraak die geannuleerd moet worden',
        },
        name: { type: 'string', description: 'Naam van de klant (optioneel ter verificatie)' },
        phoneNumber: {
          type: 'string',
          description:
            "Telefoonnummer van de klant (verplicht ter verificatie). Herken dat '06…' gelijk staat aan '+316…'.",
        },
        reason: { type: 'string', description: 'Reden van annulering' },
      },
      required: ['start', 'phoneNumber'],
    };

    tools.push(
      {
        type: 'function',
        function: {
          name: TOOL_NAMES.scheduleGoogleCalendarEvent,
          description:
            'Maak een nieuw event in Google Agenda. Vraag eerst datum/tijd en daarna de naam ter verificatie; het telefoonnummer haal je automatisch uit het systeem. Bevestig de afspraak uiteindelijk door alleen de datum en tijd te herhalen.',
          parameters: createCalendarParameters,
        },
        server: {
          url: `${this.toolBaseUrl}/vapi/tools`,
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
        server: {
          url: `${this.toolBaseUrl}/vapi/tools`,
        },
      },
      {
        type: 'function',
        function: {
          name: TOOL_NAMES.cancelGoogleCalendarEvent,
          description:
            "Annuleer een bestaand event in Google Agenda na verificatie met telefoonnummer (onthoud dat '06…' gelijk is aan '+316…').",
          parameters: cancelCalendarParameters,
        },
        server: {
          url: `${this.toolBaseUrl}/vapi/tools`,
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
      callId: callId ?? null,
    });
    if (callId) {
      this.activeSessionsByCallId.set(callId, { session, callbacks, callSid });
    }

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
        const parsed = JSON.parse(s);
        await this.handleRealtimeEvent(parsed, session, callbacks);
      } catch (e) {
        console.error(`[${callSid}] [Vapi] Bad JSON frame`, s.slice(0, 120), e);
      }
    });

    ws.on('close', (code) => {
      console.log(`[${callSid}] [Vapi] realtime session closed with code ${code}`);
      clearInterval(keepAlive);
      callbacks.onSessionClosed?.();
      this.unregisterActiveSession(session);
      this.clearSessionConfig(callSid);
    });

    ws.on('error', (error) => {
      console.error(`[${callSid}] [Vapi] realtime session error`, error);
      callbacks.onSessionError?.(error as Error);
      this.unregisterActiveSession(session);
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
    const callIdCandidates: unknown[] = [
      data?.message?.call?.id,
      data?.message?.callId,
      data.callId,
      data.call_id,
      data?.call?.id,
      data?.call?.callId,
      data?.call?.call_id,
      data?.call?.vapi_call_id,
      data?.data?.callId,
      data?.data?.call_id,
      data?.data?.call?.id,
      data?.event?.callId,
      data?.event?.call_id,
      data?.event?.call?.id,
      data?.session?.callId,
      data?.session?.call_id,
      data?.session?.call?.id,
      data?.toolCall?.callId,
      data?.tool_call?.call_id,
      data?.tool?.callId,
      data?.tool?.call_id,
    ];

    let callId: string | null = null;
    for (const candidate of callIdCandidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) {
          callId = trimmed;
          break;
        }
      }

      if (typeof candidate === 'number' || typeof candidate === 'bigint') {
        const text = candidate.toString().trim();
        if (text) {
          callId = text;
          break;
        }
      }
    }

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
    _session: VapiRealtimeSession,
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
      default:
        break;
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

    if (raw?.role === 'tool_calls') {
      const nestedCount = Array.isArray(raw.tool_calls) ? raw.tool_calls.length : 0;
      const hasDirectName = typeof raw.name === 'string' && raw.name.length > 0;
      if (nestedCount > 0 || !hasDirectName) {
        console.warn(
          `[VapiClient] ⚠️ normalizeToolCall skipping tool_calls wrapper (${nestedCount} nested call(s))`,
        );
        return null;
      }
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
  ): Promise<unknown> {
    console.log(`[VapiClient] 🔧 === EXECUTING TOOL CALL ===`);
    console.log(`[VapiClient] Tool ID: ${call.id}`);
    console.log(`[VapiClient] Tool Name: ${call.name}`);
    console.log(`[VapiClient] Tool Args:`, JSON.stringify(call.args, null, 2));

    const cachedEntry = this.toolResponseLog.get(call.id);
    if (cachedEntry) {
      console.log(`[VapiClient] ♻️ Returning cached tool response for ${call.id}`);
      return cachedEntry.payload;
    }

    const normalizedToolName = this.normalizeToolName(call.name);
    console.log(`[VapiClient] Normalized name: ${normalizedToolName}`);

    const googleTools = new Set<(typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]>([
      TOOL_NAMES.scheduleGoogleCalendarEvent,
      TOOL_NAMES.checkGoogleCalendarAvailability,
      TOOL_NAMES.cancelGoogleCalendarEvent,
    ]);

    const sessionContext = this.sessionContexts.get(session);
    const config = this.getConfigForCall(sessionContext?.callSid);

    let finalPayload: unknown = null;
    let payloadWasSet = false;

    const commitPayload = (payload: unknown) => {
      let payloadPreview: string | undefined;
      try {
        payloadPreview = JSON.stringify(payload).slice(0, 200);
      } catch (error) {
        console.warn('[VapiClient] ⚠️ Failed to stringify payload for preview', error);
      }

      console.log(`[VapiClient] 💾 Recording tool response`, {
        toolCallId: call.id,
        payloadType: typeof payload,
        payloadPreview,
      });
      this.recordToolResponse(call.id, payload, normalizedToolName);
      finalPayload = payload;
      payloadWasSet = true;
      return payload;
    };

    if (!config) {
      console.error('[VapiClient] ❌ No config found for session');
      const payload = {
        success: false,
        error: 'Session not configured',
      };
      return commitPayload(payload);
    }

    console.log(
      `[VapiClient] Config found - Company: ${config.company.name}, Google: ${config.hasGoogleIntegration}`,
    );

    if (normalizedToolName && googleTools.has(normalizedToolName) && !config.hasGoogleIntegration) {
      console.warn(`[VapiClient] ⚠️ Google tool called but integration disabled`);
      const payload = {
        success: false,
        error: 'Google integration not available',
      };
      return commitPayload(payload);
    }

    const sendSuccess = (data: unknown) => {
      const payload = { success: true, data };
      console.log(`[VapiClient] ✅ Tool response payload`, {
        toolCallId: call.id,
        payload,
      });
      return payload;
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
      return payload;
    };

    const companyId = config.company.id;
    const args = call.args ?? {};

    const handlers: Record<string, () => Promise<unknown>> = {
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

        return sendSuccess({
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
          const availabilityResult = await this.getAvailabilityWithCache(
            companyId,
            date,
            openHour,
            closeHour,
          );

          if (availabilityResult.durationMs > 0) {
            console.log(
              `[VapiClient] ⏱️ Google availability resolved in ${availabilityResult.durationMs}ms (${availabilityResult.source})`,
            );
          } else {
            console.log(`[VapiClient] ♻️ Using cached availability result`);
          }

          const { availability, availableRanges } = availabilityResult;
          const isCacheHit = availabilityResult.source === 'cache';
          console.log(`[VapiClient] ✅ Busy intervals:`, availability.busy);
          console.log(`[VapiClient] ✅ Derived available ranges:`, availableRanges);

          const busyCount = availability.busy.length;
          const availableCount = availableRanges.length;
          const message = busyCount === 0
            ? 'Geen afspraken gepland: de volledige dag is beschikbaar.'
            : availableCount === 0
              ? 'Alle tijden binnen het venster zijn bezet.'
              : `Beschikbaarheid gevonden in ${availableCount} vrije blok${availableCount === 1 ? '' : 'ken'}.`;

          return sendSuccess({
            date,
            openHour,
            closeHour,
            operatingWindow: availability.operatingWindow,
            busy: availability.busy,
            availableRanges,
            cached: isCacheHit,
            sharedRequest: availabilityResult.source === 'pending' ? true : undefined,
            retrievalDurationMs: availabilityResult.durationMs,
            message,
          });
        } catch (error) {
          console.error(`[VapiClient] ❌ Error getting beschikbaarheid:`, error);
          const fallbackMessage =
            error instanceof Error && /Beschikbaarheidsaanvraag/i.test(error.message)
              ? 'Het ophalen van de agenda duurde te lang. Probeer het later opnieuw.'
              : error instanceof Error
                ? error.message
                : 'Failed to get availability';
          return sendError(fallbackMessage, error);
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
        const providedPhoneNumber = this.normalizeStringArg(args['phoneNumber']);
        const sessionPhoneNumber = this.normalizeStringArg(sessionContext?.callerNumber);
        const rawPhoneNumber = providedPhoneNumber ?? sessionPhoneNumber ?? null;
        const phoneNumber = this.normalizePhoneNumber(rawPhoneNumber);

        console.log(`[VapiClient] Event params:`, {
          summary,
          start,
          end,
          name,
          rawPhoneNumber,
          phoneNumber,
        });

        if (!summary || !start || !end || !name) {
          throw new Error('Ontbrekende verplichte velden voor het maken van een agenda item.');
        }

        const details: string[] = [];
        if (description) details.push(description);
        details.push(`Naam: ${name}`);
        if (phoneNumber) details.push(`Telefoonnummer: ${phoneNumber}`);
        const compiledDescription = details.join('\n');

        const event: calendar_v3.Schema$Event = {
          summary,
          description: compiledDescription,
          location: location ?? undefined,
          start: { dateTime: start },
          end: { dateTime: end },
        };

        const privateProperties: Record<string, string> = {
          customerName: name,
        };

        if (phoneNumber) {
          privateProperties.customerPhoneNumber = phoneNumber;
        }

        event.extendedProperties = { private: privateProperties };

        console.log(`[VapiClient] Creating event in calendar...`);
        const created = await this.googleService.scheduleEvent(companyId, event);
        console.log(`[VapiClient] ✅ Event created:`, created.id);

        return sendSuccess({ event: created });
      },
      [TOOL_NAMES.cancelGoogleCalendarEvent]: async () => {
        console.log(`[VapiClient] 🗑️ === CANCEL CALENDAR EVENT ===`);

        const start = this.normalizeStringArg(args['start'] ?? args['startTime']);
        const name = this.normalizeStringArg(args['name']);
        const phoneNumber = this.normalizeStringArg(args['phoneNumber']);
        const reason = this.normalizeStringArg(args['reason']);

        console.log(`[VapiClient] Cancel params:`, { start, name, phoneNumber, reason });

        if (!start || !phoneNumber) {
          throw new Error('Ontbrekende starttijd of telefoonnummer om te annuleren.');
        }

        console.log(`[VapiClient] Calling GoogleService.cancelEvent...`);
        await this.googleService.cancelEvent(
          companyId,
          start,
          phoneNumber,
          name ?? undefined,
        );
        console.log(`[VapiClient] ✅ Event cancelled`);

        return sendSuccess({
          start,
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
      return sendError(`Onbekende tool: ${call.name}`);
    }

    console.log(`[VapiClient] 🎯 Handler found, executing...`);

    try {
      const handlerResult = await handler();
      console.log(`[VapiClient] ✅ Handler completed with result:`, handlerResult);

      if (!payloadWasSet && handlerResult) {
        console.log(`[VapiClient] Using handler return value as payload`);
        finalPayload = handlerResult;
        this.recordToolResponse(call.id, handlerResult, normalizedToolName);
      } else if (!payloadWasSet) {
        console.log(`[VapiClient] Handler returned no result, setting finalPayload to null`);
        finalPayload = null;
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message || `Onbekende fout bij uitvoeren van ${call.name}`
          : `Onbekende fout bij uitvoeren van ${call.name}`;
      console.error(`[VapiClient] ❌ Handler threw error:`, error);
      return sendError(message, error);
    }

    if (!finalPayload) {
      console.error(`[VapiClient] ❌ CRITICAL: No payload was set after execution!`);
      const payload = {
        success: false,
        error: `Tool ${call.name} executed without response`,
      };
      commitPayload(payload);
    }

    return finalPayload;
  }

  private async getAvailabilityWithCache(
    companyId: bigint,
    date: string,
    openHour: number,
    closeHour: number,
  ): Promise<{
    availability: CalendarAvailability;
    availableRanges: AvailableRange[];
    source: 'fresh' | 'cache' | 'pending';
    durationMs: number;
  }> {
    const key = this.buildAvailabilityCacheKey(companyId, date, openHour, closeHour);
    const now = Date.now();
    const cached = this.availabilityCache.get(key);

    if (cached) {
      if (cached.expiresAt > now) {
        return {
          availability: cached.availability,
          availableRanges: cached.availableRanges,
          source: 'cache',
          durationMs: 0,
        };
      }

      this.availabilityCache.delete(key);
    }

    const pending = this.availabilityPending.get(key);
    if (pending) {
      console.log(`[VapiClient] ⏳ Awaiting in-flight availability request for ${key}`);
      const result = await pending.promise;
      return {
        availability: result.availability,
        availableRanges: result.availableRanges,
        source: 'pending',
        durationMs: Date.now() - pending.startedAt,
      };
    }

    const startedAt = Date.now();
    const availabilityPromise = (async () => {
      const availability = await this.googleService.getAvailableSlots(
        companyId,
        date,
        openHour,
        closeHour,
      );
      return {
        availability,
        availableRanges: this.deriveAvailableRanges(availability),
      };
    })();
    const fetchPromise = this.runWithTimeout(
      availabilityPromise,
      this.availabilityRequestTimeoutMs,
      `Beschikbaarheidsaanvraag duurde langer dan ${this.availabilityRequestTimeoutMs}ms`,
    );

    this.availabilityPending.set(key, { promise: fetchPromise, startedAt });

    try {
      const result = await fetchPromise;
      this.availabilityCache.set(key, {
        availability: result.availability,
        availableRanges: result.availableRanges,
        expiresAt: Date.now() + this.availabilityCacheTtlMs,
      });
      return {
        availability: result.availability,
        availableRanges: result.availableRanges,
        source: 'fresh',
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.availabilityPending.delete(key);
    }
  }

  private buildAvailabilityCacheKey(
    companyId: bigint,
    date: string,
    openHour: number,
    closeHour: number,
  ): string {
    return [companyId.toString(), date, openHour, closeHour].join('|');
  }

  private runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const guardedPromise = new Promise<T>((resolve, reject) => {
      let settled = false;

      const clear = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      promise
        .then((value) => {
          if (settled) return;
          settled = true;
          clear();
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clear();
          reject(error);
        });

      timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn(`[VapiClient] ⚠️ Operation timed out after ${timeoutMs}ms`);
        clear();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    return guardedPromise;
  }

  public async handleToolWebhookRequest(
    body: unknown,
    callIdHint?: string | null,
  ): Promise<{ results: Array<{ toolCallId: string; result?: any; error?: any }> }> {
    console.log('[VapiClient] 🌐 Received tool webhook payload');
    logPayload('[VapiClient] 🧾 Tool webhook payload', body, PAYLOAD_LOG_LIMIT);

    const raw = body as Record<string, unknown> | null | undefined;
    const callId = callIdHint ?? VapiClient.extractCallIdFromWebhook(raw);
    const rawToolCall = this.extractToolCallPayload(raw);
    const normalized = this.normalizeToolCall(rawToolCall);
    const fallbackToolCallId = this.extractToolCallId(raw);
    const toolCallId = normalized?.id ?? fallbackToolCallId ?? `tool_${Date.now()}`;
    console.log(
      '[VapiClient] 🔎 Extracted webhook context',
      {
        callId: callId ?? '<none>',
        normalizedName: normalized?.name ?? '<unknown>',
        normalizedId: normalized?.id ?? '<none>',
        fallbackToolCallId: fallbackToolCallId ?? '<none>',
        finalToolCallId: toolCallId,
        callIdHint: callIdHint ?? '<none>',
      },
    );

    if (!normalized) {
      console.warn('[VapiClient] ⚠️ Unable to normalize tool call payload');

      // ⬇️ IMPORTANT: pull the real id from message.* and echo it back
      const realId =
        this.extractToolCallId(raw)  // now checks message.toolCalls / toolCallList / toolWithToolCallList
        ?? toolCallId                // keep your earlier computed value as fallback
        ?? `tool_${Date.now()}`;

      const payload = { success: false, error: 'Kon tool-aanroep niet verwerken (ongeldig formaat).' };

      this.recordToolResponse(realId, payload, null);

      return { results: [{ toolCallId: realId, result: payload }] };
    }

    const sessionInfo = callId ? this.activeSessionsByCallId.get(callId) : undefined;
    console.log(
      '[VapiClient] 🔍 Session lookup result',
      {
        callId: callId ?? '<none>',
        sessionFound: Boolean(sessionInfo),
        activeTrackedCallIds: Array.from(this.activeSessionsByCallId.keys()),
        totalActiveSessions: this.activeSessionsByCallId.size,
      },
    );
    if (!sessionInfo) {
      // Try to find session by any available callId in the active sessions
      let fallbackSessionInfo: { session: VapiRealtimeSession; callbacks: VapiRealtimeCallbacks; callSid: string } | undefined;
      
      if (this.activeSessionsByCallId.size > 0) {
        // If we have active sessions but no matching callId, use the first available session
        const firstCallId = Array.from(this.activeSessionsByCallId.keys())[0];
        fallbackSessionInfo = this.activeSessionsByCallId.get(firstCallId);
        console.log(`[VapiClient] 🔄 Using fallback session for callId: ${firstCallId}`);
      }
      
      const sessionToUse = sessionInfo || fallbackSessionInfo;
      
      if (!sessionToUse) {
        const recorded = this.toolResponseLog.get(toolCallId);
        if (recorded?.payload) {
          console.log(
            `[VapiClient] ♻️ Returning cached tool response for ${toolCallId} (no active session)`,
          );
          const response = { results: [{ toolCallId, result: recorded.payload }] };
          logPayload('[VapiClient] ⇨ Tool webhook response (from cache)', response);
          return response;
        }
        const payload = {
          success: false,
          error: callId
            ? `Geen actieve Vapi-sessie gevonden voor callId ${callId}.`
            : 'Geen actieve Vapi-sessie beschikbaar voor tool webhook.',
        };
        this.recordToolResponse(toolCallId, payload, this.normalizeToolName(normalized.name));
        const response = { results: [{ toolCallId, result: payload }] };
        logPayload('[VapiClient] ⇨ Tool webhook response (no session)', response);
        return response;
      }

      // Use the fallback session
      const payload =
        await this.executeToolCall(normalized, sessionToUse.session, sessionToUse.callbacks)
        ?? { success: false, error: 'Tool execution returned empty result.' };

      logPayload('[VapiClient] 📦 Tool execution payload (fallback session)', payload);
      const response = { results: [{ toolCallId, result: payload }] };
      logPayload('[VapiClient] ⇨ Tool webhook response (fallback session)', response);
      return response;
    }

    const payload =
      await this.executeToolCall(normalized, sessionInfo.session, sessionInfo.callbacks)
      ?? { success: false, error: 'Tool execution returned empty result.' };

    // IMPORTANT: return the RAW payload object (not stringified, not just a message)
    logPayload('[VapiClient] 📦 Tool execution payload', payload);
    const response = { results: [{ toolCallId, result: payload }] };
    logPayload('[VapiClient] ⇨ Tool webhook response (success)', response);
    return response;
  }

  private recordToolResponse(
    toolCallId: string,
    payload: unknown,
    normalizedName?: string | null,
  ) {
    if (this.toolResponseLog.size > 100) {
      const oldestKey = this.toolResponseLog.keys().next().value as string | undefined;
      if (oldestKey) {
        console.log(`[VapiClient] 🧹 Evicting cached tool response ${oldestKey}`);
        this.toolResponseLog.delete(oldestKey);
      }
    }

    console.log('[VapiClient] 🗂️ Recording tool response', {
      toolCallId,
      normalizedName: normalizedName ?? '<unknown>',
    });
    logPayload('[VapiClient] 🗂️ Tool response payload (cached)', payload);
    this.toolResponseLog.set(toolCallId, {
      timestamp: Date.now(),
      payload,
      normalizedName,
    });
  }

  private unregisterActiveSession(session: VapiRealtimeSession) {
    const context = this.sessionContexts.get(session);
    if (context?.callId) {
      console.log(
        '[VapiClient] 🔻 Removing active session for callId',
        context.callId,
      );
      this.activeSessionsByCallId.delete(context.callId);
    }
    this.sessionContexts.delete(session);
  }

  private extractToolCallPayload(body: any): any {
    if (body?.message) {
      const m = body.message;

      if (Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        return m.toolCalls[0]; // { id, type, function: { name, arguments } }
      }

      if (Array.isArray(m.toolCallList) && m.toolCallList.length > 0) {
        return m.toolCallList[0]; // same shape
      }

      if (Array.isArray(m.toolWithToolCallList) && m.toolWithToolCallList.length > 0) {
        const twtcl = m.toolWithToolCallList[0];
        if (twtcl?.toolCall) return twtcl.toolCall; // { id, type, function: {...} }
      }
    }

    const arrayCandidates = [
      body.tool_calls,
      body.toolCalls,
      body.tools,
      body?.data?.tool_calls,
      body?.data?.toolCalls,
      body?.data?.tools,
      body?.event?.tool_calls,
      body?.event?.toolCalls,
    ];

    for (const candidate of arrayCandidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate[0];
      }
    }

    const candidates = [
      body.toolCall,
      body.tool_call,
      body.tool,
      body.function,
      body?.data?.toolCall,
      body?.data?.tool_call,
      body?.data?.tool,
      body?.event?.toolCall,
      body?.event?.tool_call,
      body?.event?.tool,
      body?.payload?.toolCall,
      body?.payload?.tool,
    ];

    for (const candidate of candidates) {
      if (candidate) {
        return candidate;
      }
    }

    return body;
  }

  private extractToolCallId(body: any): string | null {
    // in VapiClient.extractToolCallId(body: any)
    if (body?.message) {
      const m = body.message;

      if (Array.isArray(m.toolCalls) && m.toolCalls[0]?.id) {
        return String(m.toolCalls[0].id).trim();
      }
      if (Array.isArray(m.toolCallList) && m.toolCallList[0]?.id) {
        return String(m.toolCallList[0].id).trim();
      }
      if (Array.isArray(m.toolWithToolCallList) &&
        m.toolWithToolCallList[0]?.toolCall?.id) {
        return String(m.toolWithToolCallList[0].toolCall.id).trim();
      }
    }


    const candidates: unknown[] = [
      body.toolCallId,
      body.tool_call_id,
      body.tool_callId,
      body.tool?.id,
      body.toolCall?.id,
      body.tool_call?.id,
      body?.data?.tool?.id,
      body?.data?.toolCall?.id,
      body?.event?.tool?.id,
      body?.event?.toolCall?.id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      }
    }

    return null;
  }

  public static extractCallIdFromWebhook(body: any): string | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const candidates: unknown[] = [
      body?.message?.call?.id,
      body?.message?.callId,
      body.callId,
      body.call_id,
      body?.call?.id,
      body?.call?.callId,
      body?.call?.call_id,
      body?.call?.vapi_call_id,
      body?.data?.callId,
      body?.data?.call_id,
      body?.data?.call?.id,
      body?.event?.callId,
      body?.event?.call_id,
      body?.event?.call?.id,
      body?.session?.callId,
      body?.session?.call_id,
      body?.session?.call?.id,
      body?.toolCall?.callId,
      body?.tool_call?.call_id,
      body?.tool?.callId,
      body?.tool?.call_id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      }
      if (typeof candidate === 'number' || typeof candidate === 'bigint') {
        const text = candidate.toString();
        if (text.trim()) return text.trim();
      }
    }

    return null;
  }

  private normalizeToolName(name: string): (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES] | null {
    const normalized = this.normalizeStringArg(name);
    if (!normalized) {
      return null;
    }

    const snakeCase = normalized
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-z0-9_]+/gi, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();

    const alias =
      LEGACY_TOOL_ALIASES.get(snakeCase) ?? LEGACY_TOOL_ALIASES.get(normalized.toLowerCase());
    if (alias) {
      return alias;
    }

    return KNOWN_TOOL_NAMES.has(snakeCase as (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES])
      ? (snakeCase as (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES])
      : null;
  }

  private normalizePhoneNumber(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const hasLeadingPlus = trimmed.startsWith('+');
    const digitsOnly = trimmed.replace(/[^0-9]/g, '');
    if (!digitsOnly) {
      return null;
    }

    if (hasLeadingPlus) {
      return `+${digitsOnly}`;
    }

    if (digitsOnly.startsWith('00')) {
      return `+${digitsOnly.slice(2)}`;
    }

    if (digitsOnly.length === 10 && digitsOnly.startsWith('06')) {
      return `+31${digitsOnly.slice(1)}`;
    }

    if (digitsOnly.length === 9 && digitsOnly.startsWith('6')) {
      return `+31${digitsOnly}`;
    }

    return digitsOnly;
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
    console.log(payload)
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

    console.log(`[VapiClient] 🏗️ Building assistant payload for company: ${config.company.name}, Google integration: ${config.hasGoogleIntegration}`);
    const tools = this.getTools(config.hasGoogleIntegration);
    console.log(`[VapiClient] 🛠️ Generated ${tools.length} tools:`, tools.map(t => t.function?.name || 'unknown'));

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
    if (voiceId) payload.voice = {
      provider: '11labs',
      model: 'eleven_turbo_v2_5',
      voiceId,
      stability: 0.4,
      similarityBoost: 0.75,
      style: 0,
      useSpeakerBoost: false,
      language: 'nl',
    };

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
