// src/clients/VapiClient.ts
import axios, { AxiosInstance } from 'axios';
import WebSocket, { RawData } from 'ws';
import { inject, injectable, delay } from 'tsyringe';
import { CompanyModel } from '../business/models/CompanyModel';
import { ReplyStyleModel } from '../business/models/ReplyStyleModel';
import { CompanyInfoModel } from '../business/models/CompanyInfoModel';
import { CompanyDetailsModel } from '../business/models/CompanyDetailsModel';
import { CompanyHourModel } from '../business/models/CompanyHourModel';
import { CompanyCallerModel } from '../business/models/CompanyCallerModel';
import { CompanyContactModel } from '../business/models/CompanyContactModel';
import { AppointmentTypeModel } from '../business/models/AppointmentTypeModel';
import { StaffMemberModel } from '../business/models/StaffMemberModel';
import { VoiceSettingModel } from '../business/models/VoiceSettingsModel';
import type { calendar_v3 } from 'googleapis';
import { GoogleService } from '../business/services/GoogleService';
import { CompanyService } from '../business/services/CompanyService';
import type { CalendarAvailability, CalendarAvailabilityCalendar, CalendarAvailabilityWindow } from '../business/services/GoogleService';
import { VapiSessionRegistry, VapiSessionRecord } from '../business/services/VapiSessionRegistry';
import { getWorkerId } from '../config/workerIdentity';
import type { CalendarProvider } from '../business/services/IntegrationService';
import { ProductKnowledgeService } from '../business/services/ProductKnowledgeService';
import { ShopifyService } from '../business/services/ShopifyService';
import { WooCommerceService } from '../business/services/WooCommerceService';

type CompanyContext = {
  details: CompanyDetailsModel | null;
  contact: CompanyContactModel | null;
  hours: CompanyHourModel[];
  info: CompanyInfoModel[];
  callers: CompanyCallerModel[];
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

type SessionContextState = {
  callSid: string;
  callerNumber: string | null;
  callerName: string | null;
  callId: string | null;
  preferredStaffId: number | null;
  preferredCalendarId: string | null;
};

type CachedAvailabilityEntry = {
  availability: CalendarAvailability;
  availableRanges: AvailableRange[];
  perCalendarRanges: Record<string, AvailableRange[]>;
  expiresAt: number;
};

type PendingAvailabilityResult = {
  availability: CalendarAvailability;
  availableRanges: AvailableRange[];
  perCalendarRanges: Record<string, AvailableRange[]>;
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
  callers?: { name: string; phoneNumber: string }[];
};

type ProductSnapshot = {
  id: string;
  name: string;
  sku?: string | null;
  summary?: string | null;
  synonyms?: string[];
  status: string;
  version?: number;
  updatedAt?: string;
};

export type VapiAssistantConfig = {
  company: CompanyModel;
  hasGoogleIntegration: boolean;
  calendarProvider: CalendarProvider | null;
  commerceStores?: Array<'shopify' | 'woocommerce'> | null;
  replyStyle: ReplyStyleModel;
  companyContext: CompanyContext;
  schedulingContext: SchedulingContext;
  voiceSettings: VoiceSettingModel;
  productCatalog?: ProductSnapshot[];
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
      `${label} (truncated to ${limit} of ${serialized.length} chars): ${serialized.slice(0, limit)}ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡Ãƒâ€šÃ‚Âª`,
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
  getProductDetailsByName: 'get_product_details_by_name',
  getOrderStatus: 'get_order_status',
  fetchProductInfo: 'fetch_product_info',
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
  TOOL_NAMES.getProductDetailsByName,
  TOOL_NAMES.getOrderStatus,
  TOOL_NAMES.fetchProductInfo,
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
      logPayload(`[VapiRealtimeSession] ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â¿ Sending JSON frame (${type})`, frame, PAYLOAD_LOG_LIMIT);
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
  private readonly availabilityCache = new Map<string, CachedAvailabilityEntry>();
  private readonly availabilityPending = new Map<
    string,
    { promise: Promise<PendingAvailabilityResult>; startedAt: number }
  >();
  private readonly availabilityCacheTtlMs = 2 * 60 * 1000; // 2 minutes
  private readonly availabilityRequestTimeoutMs = 2500; // 2.5 seconds
  private readonly toolBaseUrl: string;
  private readonly transportProvider: string;
  private readonly sessionContexts = new WeakMap<VapiRealtimeSession, SessionContextState>();
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
  private readonly workerId: string;

  constructor(
    @inject(GoogleService) private readonly googleService: GoogleService,
    @inject(delay(() => CompanyService)) private readonly companyService: CompanyService = {} as any,
    @inject(ProductKnowledgeService) private readonly productKnowledgeService: ProductKnowledgeService = {} as any,
    @inject(VapiSessionRegistry)
    private readonly sessionRegistry: VapiSessionRegistry = {
      registerSession: async () => { },
      findSession: async () => null,
      clearSessionForCallId: async () => { },
    } as any,
    @inject(ShopifyService) private readonly shopifyService: ShopifyService = {} as any,
    @inject(WooCommerceService) private readonly wooService: WooCommerceService = {} as any,
  ) {
    this.apiKey = process.env.VAPI_API_KEY || '';
    if (!this.apiKey) {
      console.warn('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂI_API_KEY is not set. Requests to Vapi will fail.');
    }

    const apiBaseUrl = process.env.VAPI_API_BASE_URL || 'https://api.vapi.ai';
    this.apiPathPrefix = this.normalizePathPrefix(process.env.VAPI_API_PATH_PREFIX ?? '');
    this.modelProvider = process.env.VAPI_MODEL_PROVIDER || 'openai';
    this.modelName = process.env.VAPI_MODEL_NAME || 'gpt-4o-mini';
    this.transportProvider = 'vapi.websocket';

    this.toolBaseUrl = (process.env.SERVER_URL || 'https://api.callingbird.nl').replace(/\/$/, '');

    this.workerId = getWorkerId();

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
      throw new Error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â paths must start with '/'. Received: ${path}`);
    }
    const normalizedPath = path.replace(/^\/+/, '');
    const segments = [this.apiPathPrefix, normalizedPath].filter((s) => s.length > 0);
    return `/${segments.join('/')}`;
  }

  public setCompanyInfo(
    callSid: string,
    company: CompanyModel,
    hasGoogleIntegration: boolean,
    calendarProvider: CalendarProvider | null,
    replyStyle: ReplyStyleModel,
    context: CompanyContext,
    schedulingContext: SchedulingContext,
    productCatalogOrVoice: ProductSnapshot[] | VoiceSettingModel,
    voiceSettingsOrCommerce?: VoiceSettingModel | Array<'shopify' | 'woocommerce'>,
    commerceStoresArg: Array<'shopify' | 'woocommerce'> = [],
  ) {
    const productCatalog: ProductSnapshot[] = Array.isArray(productCatalogOrVoice)
      ? productCatalogOrVoice
      : [];
    const voiceSettings: VoiceSettingModel = Array.isArray(productCatalogOrVoice)
      ? (voiceSettingsOrCommerce as VoiceSettingModel)
      : (productCatalogOrVoice as VoiceSettingModel);
    const commerceStores: Array<'shopify' | 'woocommerce'> = Array.isArray(voiceSettingsOrCommerce)
      ? voiceSettingsOrCommerce
      : commerceStoresArg;

    if (!voiceSettings) {
      throw new Error('[VapiClient] voiceSettings are required when setting company info.');
    }

    const config: VapiAssistantConfig = {
      company,
      hasGoogleIntegration,
      calendarProvider,
      replyStyle,
      companyContext: context,
      schedulingContext,
      voiceSettings,
      productCatalog,
      commerceStores,
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
    return this.deriveAvailableRangesFromBusy(availability.operatingWindow, availability.busy);
  }

  private deriveAvailableRangesFromBusy(
    operatingWindow: CalendarAvailabilityWindow,
    busy: CalendarAvailability['busy'],
  ): AvailableRange[] {
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

  private mergeAvailableRanges(rangeSets: AvailableRange[][]): AvailableRange[] {
    const intervals = rangeSets
      .flat()
      .map((range) => {
        const start = new Date(range.start).getTime();
        const end = new Date(range.end).getTime();
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
          return null;
        }
        return { start, end };
      })
      .filter((entry): entry is { start: number; end: number } => entry !== null)
      .sort((a, b) => a.start - b.start);

    if (intervals.length === 0) {
      return [];
    }

    const merged: { start: number; end: number }[] = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ ...interval });
        continue;
      }

      if (interval.start <= last.end) {
        last.end = Math.max(last.end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    }

    return merged.map((interval) => {
      const durationMinutes = Math.max(0, Math.round((interval.end - interval.start) / 60000));
      return {
        start: new Date(interval.start).toISOString(),
        end: new Date(interval.end).toISOString(),
        durationMinutes,
      };
    });
  }

  private buildStaffCalendarMap(config: VapiAssistantConfig): Map<string, StaffMemberModel[]> {
    const map = new Map<string, StaffMemberModel[]>();
    const staffMembers = config.schedulingContext.staffMembers ?? [];
    for (const member of staffMembers) {
      const calendarId = this.normalizeStringArg((member as any)?.googleCalendarId ?? null);
      if (!calendarId) {
        continue;
      }
      const existing = map.get(calendarId) ?? [];
      existing.push(member);
      map.set(calendarId, existing);
    }
    return map;
  }

  private resolveStaffPreference(
    config: VapiAssistantConfig,
    args: Record<string, unknown>,
    sessionContext: SessionContextState | null,
  ): {
    staffMember: StaffMemberModel | null;
    calendarId: string | null;
    explicitCalendarId: string | null;
  } {
    const staffMembers = config.schedulingContext.staffMembers ?? [];
    const staffById = new Map<number, StaffMemberModel>();
    const staffByName = new Map<string, StaffMemberModel>();

    for (const member of staffMembers) {
      staffById.set(member.id, member);
      const normalizedName = this.normalizeStringArg(member.name)?.toLowerCase();
      if (normalizedName) {
        staffByName.set(normalizedName, member);
      }
    }

    const staffIdArgs = [
      this.normalizeStringArg(args['staffMemberId']),
      this.normalizeStringArg(args['preferredStaffId']),
      this.normalizeStringArg(args['staffId']),
    ];

    let matchedStaff: StaffMemberModel | null = null;
    for (const candidate of staffIdArgs) {
      if (!candidate) continue;
      const parsed = Number.parseInt(candidate, 10);
      if (!Number.isNaN(parsed)) {
        const staff = staffById.get(parsed);
        if (staff) {
          matchedStaff = staff;
          break;
        }
      }
    }

    if (!matchedStaff) {
      const staffNameArgs = [
        this.normalizeStringArg(args['staffMemberName']),
        this.normalizeStringArg(args['preferredStaffName']),
        this.normalizeStringArg(args['staffName']),
        this.normalizeStringArg(args['preferredStaff']),
        this.normalizeStringArg(args['employeeName']),
      ];

      for (const candidate of staffNameArgs) {
        if (!candidate) continue;
        const normalized = candidate.toLowerCase();
        const direct = staffByName.get(normalized);
        if (direct) {
          matchedStaff = direct;
          break;
        }

        const partial = staffMembers.find((member) =>
          this.normalizeStringArg(member.name)?.toLowerCase().includes(normalized),
        );
        if (partial) {
          matchedStaff = partial;
          break;
        }
      }
    }

    if (!matchedStaff && typeof sessionContext?.preferredStaffId === 'number') {
      matchedStaff = staffById.get(sessionContext.preferredStaffId) ?? null;
    }

    const explicitCalendarId =
      this.normalizeStringArg(args['calendarId']) ??
      this.normalizeStringArg(args['staffCalendarId']) ??
      this.normalizeStringArg(args['googleCalendarId']);

    let calendarId = explicitCalendarId;
    if (!calendarId && matchedStaff) {
      calendarId = this.normalizeStringArg((matchedStaff as any)?.googleCalendarId ?? null);
    }

    if (!calendarId && sessionContext?.preferredCalendarId) {
      calendarId = sessionContext.preferredCalendarId;
    }

    return {
      staffMember: matchedStaff ?? null,
      calendarId: calendarId ?? null,
      explicitCalendarId: explicitCalendarId ?? null,
    };
  }

  private updateSessionStaffPreference(
    session: VapiRealtimeSession | null | undefined,
    sessionContext: SessionContextState | null,
    updates: { staffMember?: StaffMemberModel | null; calendarId?: string | null },
  ): void {
    if (!session) {
      return;
    }

    const current = sessionContext ?? this.sessionContexts.get(session);
    if (!current) {
      return;
    }

    const next: SessionContextState = {
      ...current,
      preferredStaffId:
        updates.staffMember !== undefined
          ? updates.staffMember
            ? updates.staffMember.id
            : null
          : current.preferredStaffId,
      preferredCalendarId:
        updates.calendarId !== undefined ? (updates.calendarId ?? null) : current.preferredCalendarId,
    };

    this.sessionContexts.set(session, next);
  }

  public buildSystemPrompt(config?: VapiAssistantConfig): string {
    const effectiveConfig = config ?? this.currentConfig;
    if (!effectiveConfig) {
      throw new Error(
        'Company info, reply style, context, and scheduling context must be set before generating a system prompt.',
      );
    }
    const calendarProvider = this.getEffectiveCalendarProvider(effectiveConfig);
    const calendarDescription = this.getCalendarProviderDescription(calendarProvider);
    const calendarProviderName = this.getCalendarProviderName(calendarProvider);

    const instructions: string[] = [
      `Je bent een behulpzame Nederlandse spraakassistent voor het bedrijf '${effectiveConfig.company.name}'. ${effectiveConfig.replyStyle.description}`,
      'Praat natuurlijk en menselijk en help de beller snel verder.',
      'Vandaag is {{"now" | date: "%Y-%m-%d %I:%M %p", "Europe/Amsterdam"}}. Gebruik deze datum als referentiepunt voor alle afspraken en antwoorden.',
      `Zorg dat je de juiste datum van vandaag gebruikt. Vermijd numerieke datum- en tijdnotatie (zoals 'dd-mm-jj' of '10:00'); gebruik natuurlijke taal, bijvoorbeeld 'tien uur' of '14 augustus 2025'.`,
      'Als iemand al een dag of datum noemt (bijv. "morgen", "maandag" of een concrete datum), ga daar direct mee verder zonder extra bevestiging. Vraag alleen naar een dag als deze nog niet is genoemd.',
      'Interpreteer relatieve aanduidingen (zoals "vandaag", "morgen", "volgende week") zelf ten opzichte van de huidige datum in de tijdzone Europe/Amsterdam en ga door zonder de datum terug te bevestigen.',
      'Stel voorstellen voor afspraken menselijk voor door slechts relevante tijdsopties in natuurlijke taal te benoemen en niet alle tijdsloten op te sommen.',
      'Gebruik altijd de onderstaande bedrijfscontext. Als je informatie niet zeker weet of ontbreekt, communiceer dit dan duidelijk en bied alternatieve hulp aan.',
      'Als je een vraag niet kunt beantwoorden of een verzoek niet zelf kunt afhandelen, bied dan proactief aan om de beller door te verbinden met een medewerker.',
      'Wanneer je agenda-informatie deelt, benoem expliciet welke tijden al bezet zijn en welke blokken nog vrij zijn.',
      'Als een dag volledig vrij is, zeg duidelijk dat de hele dag beschikbaar is.',
      'Wanneer een beller blijft aandringen op een volledig volgeboekte dag, bied dan actief aan om de beller door te verbinden met een medewerker.',
      'Bevestig afspraken uitsluitend door de datum en tijd in natuurlijke taal te herhalen en voeg geen andere details toe.',
      'Gebruik geen standaardzinnetjes zoals "Wacht even" wanneer je een tool gebruikt; blijf natuurlijk of ga direct verder zonder extra melding.',
      'Als er wordt gevraagd om doorverbonden te worden, gebruik altijd het bedrijfsnummer zonder naar een specifieke medewerker of afdeling te vragen.',
      'Je bent een meertalige AI-telefonist.',
      '- Detecteer automatisch in welke taal de beller spreekt.',
      '- Als de beller Nederlands spreekt, antwoord dan volledig in het Nederlands.',
      '- Als de beller Engels spreekt, antwoord dan volledig in het Engels.',
      '- Schakel direct van taal wanneer de beller van taal verandert.',
      '- Meng nooit meerdere talen in één antwoord.',

      'Je tekstoutput moet altijd in dezelfde taal zijn als de beller.',

      'Je TTS-stem is in één taal geconfigureerd, maar je mag in elke taal antwoorden; het systeem zal dit automatisch naar spraak omzetten.'
    ];

    const hasCommerce = (effectiveConfig.commerceStores?.length ?? 0) > 0;
    const productInstruction = this.buildProductInstruction(effectiveConfig.productCatalog ?? []);
    if (productInstruction) {
      instructions.push(productInstruction);
      instructions.push(
        'Gebruik productinformatie primair als handleiding/troubleshooting. Als het antwoord niet in de gids staat of onzeker is, geef dat eerlijk aan en bied direct aan om door te verbinden naar een medewerker.',
      );
    }

    if (effectiveConfig.hasGoogleIntegration) {
      instructions.push(
        `Je hebt toegang tot ${calendarDescription} van het bedrijf. Gebruik altijd eerst de tool '${TOOL_NAMES.checkGoogleCalendarAvailability}' voordat je een tijdstip voorstelt. Voor het inplannen gebruik je het telefoonnummer dat al bekend is in het systeem en vraag je alleen naar de naam van de beller voordat je '${TOOL_NAMES.scheduleGoogleCalendarEvent}' gebruikt. Voor annuleringen moet je zowel de naam als het telefoonnummer bevestigen en een telefoonnummer dat met '06' begint interpreteer je als '+316ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡Ãƒâ€šÃ‚Âª'. Vraag altijd expliciet of de afspraak definitief ingepland mag worden en controleer vooraf of je de naam goed hebt begrepen, maar herhaal bij de definitieve bevestiging alleen de datum en tijd. Als hij succesvol is ingepland dan bevestig je het alleen door de datum en tijd in natuurlijke taal te herhalen zonder de locatie.`,
        `BELANGRIJK: Voor afspraken gebruik je de agenda-tools (${calendarProviderName}), NIET de transfer_call tool.`,
        'Wanneer een beller een voorkeur uitspreekt voor een specifieke medewerker, werk dan uitsluitend met diens agenda. Zonder voorkeur kies je zelf een beschikbare medewerker en vermeld je wie de afspraak uitvoert.',
        'Noem bij het voorstellen of bevestigen van een afspraak altijd de naam van de medewerker waarbij de afspraak staat ingepland zodra dat bekend is.',
        'Plan uitsluitend afspraken met medewerkers die in het bedrijf/systeem staan. Gebruik alleen hun agenda voor beschikbaarheid en boekingen.',
        'Als er meerdere afspraaktypes beschikbaar zijn, vraag de beller altijd om een keuze. Geef eventueel suggesties op basis van wat de beller zegt, maar gebruik uitsluitend afspraaktypes die in het systeem staan.',
        'Vraagt iemand naar een medewerker die niet in het systeem staat? Leg uit dat die persoon daar niet werkt en bied aan om verder te helpen met de medewerkers die beschikbaar zijn.',
      );
    } else {
      instructions.push(
        'Je hebt geen toegang tot een agenda. Wanneer iemand een afspraak wil plannen, bied dan aan om een bericht door te geven of om de beller met een medewerker te verbinden. Vraag in dat geval alleen naar de naam van de beller.',
      );
    }

    instructions.push(
      'Gebruik de tool \'transfer_call\' zodra de beller aangeeft te willen worden doorverbonden. Gebruik altijd het standaard bedrijfsnummer. Vraag niet naar een specifieke medewerker of afdeling; verbind direct door naar de hoofd lijn en kondig aan met iets als "Natuurlijk, ik verbind u door." voordat je de transfer start.',
    );

    return instructions.join('\n\n');
  }

  /**
   * Builds the full system + context message list for non-Vapi chat surfaces (e.g. WhatsApp).
   * This mirrors the payload we send to Vapi so all channels share the same knowledge.
   */
  public buildContextMessages(config?: VapiAssistantConfig) {
    const effectiveConfig = config ?? this.currentConfig;
    if (!effectiveConfig) {
      throw new Error('Company info must be set before generating context messages.');
    }

    const instructions = this.buildSystemPrompt(effectiveConfig);
    const companyContext = this.buildCompanySnapshot(effectiveConfig);
    return this.buildModelMessages(instructions, companyContext, effectiveConfig);
  }

  private buildProductInstruction(products?: ProductSnapshot[]): string | null {
    if (!products || products.length === 0) {
      return null;
    }

    const limited = products.slice(0, 15);
    const formatted = limited.map((product) => {
      const synonymText =
        product.synonyms && product.synonyms.length > 0
          ? ` (synoniemen: ${product.synonyms.slice(0, 5).join(', ')})`
          : '';
      const skuText = product.sku ? `, sku: ${product.sku}` : '';
      return `- [${product.id}] ${product.name}${skuText}${synonymText}`;
    });

    if (products.length > limited.length) {
      formatted.push(`- ...en ${products.length - limited.length} extra producten`);
    }

    return [
      'Productcatalogus (interne kennisbank voor aftercare/handleidingen/troubleshooting; NIET de webshop-inventory. Gebruik alleen deze productId’s):',
      ...formatted,
      `Gebruik altijd de tool '${TOOL_NAMES.fetchProductInfo}' om kennisbank-informatie op te halen voordat je een antwoord geeft. Als een product niet in de lijst staat, of de gids het antwoord niet bevat, zeg eerlijk dat je het niet weet en stel voor om door te verbinden.`,
    ].join('\n');
  }

  private buildCompanySnapshot(config: VapiAssistantConfig): CompanySnapshot {
    const limitString = (value: string | null | undefined, max = 240) => {
      if (!value) return undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      if (trimmed.length <= max) return trimmed;
      return `${trimmed.slice(0, max - 1)}ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡Ãƒâ€šÃ‚Âª`;
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

    const callers = (config.companyContext.callers ?? [])
      .filter((entry) => entry.name && entry.phoneNumber)
      .slice(0, 50)
      .map((entry) => ({
        name: entry.name.trim(),
        phoneNumber: entry.phoneNumber.trim(),
      }))
      .filter((entry) => entry.name.length > 0 && entry.phoneNumber.length > 0);

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
          calendarId?: string;
          calendarSummary?: string;
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

        const calendarId = this.normalizeStringArg((staff as any)?.googleCalendarId ?? null);
        if (calendarId) {
          result.calendarId = calendarId;
        }
        const calendarSummary = this.normalizeStringArg((staff as any)?.googleCalendarSummary ?? null);
        if (calendarSummary) {
          result.calendarSummary = calendarSummary;
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
    if (callers.length > 0) snapshot.callers = callers;
    if (appointmentTypes.length > 0) snapshot.appointmentTypes = appointmentTypes;
    if (staffMembers.length > 0) snapshot.staffMembers = staffMembers;

    return snapshot;
  }

  /** ===== Tools (clean JSON Schema via `parameters`) ===== */
  public getTools(
    hasGoogleIntegration?: boolean,
    calendarProvider?: CalendarProvider | null,
    commerceStores: Array<'shopify' | 'woocommerce'> = [],
  ) {
    const enabled = Boolean(hasGoogleIntegration);
    const provider: CalendarProvider | null = calendarProvider ?? (enabled ? 'google' : null);
    const providerName = this.getCalendarProviderName(provider);
    const agendaLabel = provider ? `${providerName} agenda` : 'agenda';
    console.log(
      `[VapiClient] tools builder - calendar integration enabled: ${enabled} (${providerName})`,
    );

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

    if (commerceStores.length > 0) {
      const storeEnum = commerceStores;
      tools.push(
        {
          type: 'function',
          function: {
            name: TOOL_NAMES.getProductDetailsByName,
            description:
              'Zoek productdetails op voor een gekoppelde webshop met een herkenbare productnaam. Kies storeId uit de beschikbare winkels.',
            parameters: {
              type: 'object',
              properties: {
                storeId: {
                  type: 'string',
                  enum: storeEnum,
                  description: 'De gekoppelde winkel.',
                },
                productName: {
                  type: 'string',
                  description: 'De productnaam zoals de beller die noemt (fuzzy matching).',
                },
              },
              required: ['storeId', 'productName'],
            },
          },
          server: {
            url: `${this.toolBaseUrl}/vapi/tools`,
          },
        },
        {
          type: 'function',
          function: {
            name: TOOL_NAMES.getOrderStatus,
            description:
              'Haal de orderstatus op van een gekoppelde webshop aan de hand van het orderId dat de beller geeft.',
            parameters: {
              type: 'object',
              properties: {
                storeId: {
                  type: 'string',
                  enum: storeEnum,
                  description: 'De gekoppelde winkel.',
                },
                orderId: {
                  type: 'string',
                  description: 'Ordernummer dat door de beller is genoemd.',
                },
              },
              required: ['storeId', 'orderId'],
            },
          },
          server: {
            url: `${this.toolBaseUrl}/vapi/tools`,
          },
        },
      );
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
            "Telefoonnummer van de klant (verplicht ter verificatie). Herken dat '06ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡Ãƒâ€šÃ‚Âª' gelijk staat aan '+316ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡Ãƒâ€šÃ‚Âª'.",
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
            'Maak een nieuw event in . Vraag eerst datum/tijd en daarna de naam ter verificatie; het telefoonnummer haal je automatisch uit het systeem. Bevestig de afspraak uiteindelijk door alleen de datum en tijd te herhalen.',
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
            'Controleer beschikbare tijdsloten in  voor een opgegeven datum.',
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
            "Annuleer een bestaand event in Google Agenda na verificatie met telefoonnummer (onthoud dat '06ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡Ãƒâ€šÃ‚Âª' gelijk is aan '+316ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡Ãƒâ€šÃ‚Âª').",
          parameters: cancelCalendarParameters,
        },
        server: {
          url: `${this.toolBaseUrl}/vapi/tools`,
        },
      },
      {
        type: 'function',
        function: {
          name: TOOL_NAMES.fetchProductInfo,
          description:
            'Haal productinformatie, FAQ en policies op uit de interne kennisbank (aftercare/handleidingen/troubleshooting). Dit is NIET de webshop-inventory; gebruik alleen de productId uit de kennisbanklijst. Als je het antwoord niet vindt in de gids, geef dat eerlijk aan en stel voor om door te verbinden.',
          parameters: {
            type: 'object',
            properties: {
              productId: {
                type: 'string',
                description: 'Verplicht: productId uit de productlijst (bijv. "12").',
              },
              questionContext: {
                type: 'string',
                description: 'Optioneel: de vraag van de beller zodat alleen relevante info wordt gebruikt.',
              },
            },
            required: ['productId'],
          },
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

    if (companyContext.callers && companyContext.callers.length > 0) {
      contextPayload.callers = companyContext.callers
        .filter((caller) => caller.name && caller.phoneNumber)
        .map((caller) => ({
          name: caller.name,
          phoneNumber: caller.phoneNumber,
        }));
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
    options?: { callerNumber?: string | null; callerName?: string | null },
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
      callerName: options?.callerName ?? null,
      callId: callId ?? null,
      preferredStaffId: null,
      preferredCalendarId: null,
    });
    if (callId) {
      this.activeSessionsByCallId.set(callId, { session, callbacks, callSid });
      await this.persistSharedSession(callId, callSid);
    }
    console.log(`[${callSid}] [Vapi] Registered active session (total=${this.activeSessionsByCallId.size})`);

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
        if (buffer?.length && callbacks.onAudio) callbacks.onAudio(buffer.toString('base64'));
        return;
      }

      const s = typeof raw === 'string' ? raw : raw.toString('utf8');
      if (!s.trim().startsWith('{') && !s.trim().startsWith('[')) return;

      try {
        const parsed = JSON.parse(s);

        // Ãƒâ€šÃ‚Â­Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¦ÃƒÆ’Ã‚Â« Late-bind the Vapi callId if /call response didnÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡ÃƒÆ’Ã¢â‚¬â€œt include it
        const runtimeCallId =
          parsed?.message?.call?.id ??
          parsed?.call?.id ??
          parsed?.session?.call?.id ??
          null;

        if (runtimeCallId && !this.activeSessionsByCallId.has(runtimeCallId)) {
          this.activeSessionsByCallId.set(runtimeCallId, { session, callbacks, callSid });
          const ctx = this.sessionContexts.get(session);
          if (ctx) ctx.callId = runtimeCallId;
          console.log(`[${callSid}] [Vapi] Late-registered callId=${runtimeCallId}`);
          await this.persistSharedSession(runtimeCallId, callSid);
        }

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

    this.sendCallerContextToSession(session, {
      name: options?.callerName ?? null,
      phoneNumber: options?.callerNumber ?? null,
    });

    return { session, callId: callId ?? null };
  }

  private sendCallerContextToSession(
    session: VapiRealtimeSession,
    caller: { name?: string | null; phoneNumber?: string | null },
  ) {
    if (!session) {
      return;
    }

    const name = typeof caller?.name === 'string' ? caller.name.trim() : '';
    const phone = typeof caller?.phoneNumber === 'string' ? caller.phoneNumber.trim() : '';

    if (!name && !phone) {
      return;
    }

    const metadata: Record<string, unknown> = {};
    if (name) metadata.name = name;
    if (phone) metadata.phoneNumber = phone;

    if (Object.keys(metadata).length > 0) {
      session.sendJsonFrame({
        type: 'session.update',
        session: {
          metadata: {
            caller: metadata,
          },
        },
      });
    }

    if (name) {
      const statements = [`De beller heet ${name}. Spreek de beller aan met deze naam.`];
      if (phone) {
        statements.push(`Het telefoonnummer van de beller is ${phone}.`);
      }

      session.sendJsonFrame({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: statements.join(' '),
            },
          ],
        },
      });
    }
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
      provider: this.transportProvider,
      audioFormat: {
        format: 'mulaw',
        container: 'raw',
        sampleRate: 8000,
      },
    };

    // ÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Minimal payload, nothing else
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

    const primaryUrl =
      data?.transport?.websocketCallUrl ??
      data?.websocketCallUrl ??
      data?.url ??
      null;

    if (!primaryUrl || typeof primaryUrl !== 'string' || !primaryUrl.startsWith('ws')) {
      return null;
    }

    const fallbackUrls = Array.isArray(data?.transport?.fallbackUrls)
      ? data.transport.fallbackUrls.filter((u: any) => typeof u === 'string' && u.startsWith('ws'))
      : [];

    // Try legacy/common locations FIRST, then everything else
    const callIdCandidates: unknown[] = [
      data?.id,                      // ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã‚Â¥ÃƒÆ’Ã¢â‚¬Â° most common on POST /call
      data?.session?.id,
      data?.call?.id,

      data?.message?.call?.id,
      data?.message?.callId,

      data?.callId,
      data?.call_id,
      data?.call?.callId,
      data?.call?.call_id,
      data?.call?.vapi_call_id,

      data?.data?.call?.id,
      data?.data?.callId,
      data?.data?.call_id,

      data?.event?.call?.id,
      data?.event?.callId,
      data?.event?.call_id,

      data?.session?.call?.id,
      data?.session?.callId,
      data?.session?.call_id,

      data?.toolCall?.callId,
      data?.tool_call?.call_id,
      data?.tool?.callId,
      data?.tool?.call_id,
    ];

    let callId: string | null = null;
    for (const c of callIdCandidates) {
      if (typeof c === 'string' && c.trim()) { callId = c.trim(); break; }
      if ((typeof c === 'number' || typeof c === 'bigint') && `${c}`.trim()) {
        callId = `${c}`.trim(); break;
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
        reject(new Error(message + (body ? ` ÃƒÆ’Ã¢â‚¬ÂÃƒÆ’Ã¢â‚¬Â¡ÃƒÆ’Ã‚Â´ ${body}` : '')));
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
      console.warn(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂmalizeToolCall received null/undefined`);
      return null;
    }

    if (raw?.role === 'tool_calls') {
      const nestedCount = Array.isArray(raw.tool_calls) ? raw.tool_calls.length : 0;
      const hasDirectName = typeof raw.name === 'string' && raw.name.length > 0;
      if (nestedCount > 0 || !hasDirectName) {
        console.warn(
          `[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ normalizeToolCall skipping tool_calls wrapper (${nestedCount} nested call(s))`,
        );
        return null;
      }
    }

    console.log(
      `[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¬ Normalizing tool call. Raw keys:`,
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

      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¬ Found nested function structure - ID: ${id}, Name: ${name}`);

      if (!name) {
        console.warn(
          `[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â No tool name found in nested function. Raw:`,
          JSON.stringify(raw, null, 2),
        );
        return null;
      }

      // Parse arguments if string
      if (typeof argsRaw === 'string') {
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¬ Arguments is string, parsing...`);
        try {
          argsRaw = JSON.parse(argsRaw);
          console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Parsed arguments:`, argsRaw);
        } catch (error) {
          console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Failed to parse arguments string:`, argsRaw);
          argsRaw = {};
        }
      }

      if (!argsRaw || typeof argsRaw !== 'object') {
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ No valid arguments found, using empty object`);
        argsRaw = {};
      }

      const result = {
        id,
        name,
        args: argsRaw as Record<string, unknown>,
      };

      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Successfully normalized nested function call:`, result);
      return result;
    }

    // Fallback to original flat structure handling
    container = raw.tool_call ?? raw.toolCall ?? raw.tool ?? raw;

    if (!container) {
      console.warn(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âcontainer found in raw tool call`);
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

    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¬ Extracted - ID: ${id}, Name: ${name}`);

    if (!name) {
      console.warn(
        `[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â No tool name found. Container:`,
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
      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¬ Arguments is string, parsing...`);
      try {
        argsRaw = JSON.parse(argsRaw);
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Parsed arguments:`, argsRaw);
      } catch (error) {
        console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Failed to parse arguments string:`, argsRaw);
        argsRaw = {};
      }
    }

    if (!argsRaw || typeof argsRaw !== 'object') {
      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ No valid arguments found, using empty object`);
      argsRaw = {};
    }

    const result = {
      id,
      name,
      args: argsRaw as Record<string, unknown>,
    };

    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Successfully normalized tool call:`, result);
    return result;
  }

  private async executeToolCall(
    call: NormalizedToolCall,
    contextOrSession?:
      | {
          session?: VapiRealtimeSession | null;
          callbacks?: VapiRealtimeCallbacks | null;
          callSid?: string | null;
          config?: VapiAssistantConfig | null;
        }
      | VapiRealtimeSession
      | null,
    callbacksParam?: VapiRealtimeCallbacks | null,
  ): Promise<unknown> {
    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Âº === EXECUTING TOOL CALL ===`);
    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âl ID: ${call.id}`);
    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âl Name: ${call.name}`);
    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âl Args:`, JSON.stringify(call.args, null, 2));

    const cachedEntry = this.toolResponseLog.get(call.id);
    if (cachedEntry) {
      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Returning cached tool response for ${call.id}`);
      return cachedEntry.payload;
    }

    const normalizedToolName = this.normalizeToolName(call.name);
    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âmalized name: ${normalizedToolName}`);

    const googleTools = new Set<(typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]>([
      TOOL_NAMES.scheduleGoogleCalendarEvent,
      TOOL_NAMES.checkGoogleCalendarAvailability,
      TOOL_NAMES.cancelGoogleCalendarEvent,
    ]);

    let sessionRef: VapiRealtimeSession | null = null;
    let callbacks: VapiRealtimeCallbacks | null = null;
    let explicitCallSid: string | null | undefined;
    let explicitConfig: VapiAssistantConfig | null | undefined;

    if (contextOrSession && typeof (contextOrSession as any).session !== 'undefined') {
      const ctx = contextOrSession as {
        session?: VapiRealtimeSession | null;
        callbacks?: VapiRealtimeCallbacks | null;
        callSid?: string | null;
        config?: VapiAssistantConfig | null;
      };
      sessionRef = ctx.session ?? null;
      callbacks = ctx.callbacks ?? null;
      explicitCallSid = ctx.callSid;
      explicitConfig = ctx.config ?? null;
    } else {
      sessionRef = (contextOrSession as VapiRealtimeSession) ?? null;
      callbacks = callbacksParam ?? null;
    }

    const sessionContext = sessionRef ? this.sessionContexts.get(sessionRef) ?? null : null;
    const callSidForConfig = explicitCallSid ?? sessionContext?.callSid ?? null;
    const config = explicitConfig ?? this.getConfigForCall(callSidForConfig);

    let finalPayload: unknown = null;
    let payloadWasSet = false;

    const commitPayload = (payload: unknown) => {
      let payloadPreview: string | undefined;
      try {
        payloadPreview = JSON.stringify(payload).slice(0, 200);
      } catch (error) {
        console.warn('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Failed to stringify payload for preview', error);
      }

      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â¥ Recording tool response`, {
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
      console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â No config found for session');
      const payload = {
        success: false,
        error: 'Session not configured',
      };
      return commitPayload(payload);
    }

    console.log(
      `[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âfig found - Company: ${config.company.name}, Google: ${config.hasGoogleIntegration}`,
    );

    if (normalizedToolName && googleTools.has(normalizedToolName) && !config.hasGoogleIntegration) {
      console.warn(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Google tool called but integration disabled`);
      const payload = {
        success: false,
        error: 'Google integration not available',
      };
      return commitPayload(payload);
    }

    const sendSuccess = (data: unknown) => {
      const payload = { success: true, data };
      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool response payload`, {
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
      console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool response payload`, {
        toolCallId: call.id,
        payload,
      });
      return payload;
    };

    const companyId = config.company.id;
    const args = call.args ?? {};

    const handlers: Record<string, () => Promise<unknown>> = {
      [TOOL_NAMES.transferCall]: async () => {
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã¢â‚¬â€ === TRANSFER CALL ===`);

        const transferCallback = callbacks?.onTransferCall;
        if (!transferCallback) {
          throw new Error('Doorverbinden is niet beschikbaar in deze sessie.');
        }

        const phoneNumber = this.normalizeStringArg(args['phoneNumber']);
        const sessionCallSid = sessionContext?.callSid ?? callSidForConfig ?? null;
        const callSidFromArgs = this.normalizeStringArg(args['callSid']);
        const callSid = callSidFromArgs ?? sessionCallSid;
        const callerId = this.normalizeStringArg(args['callerId']);
        const reason = this.normalizeStringArg(args['reason']);

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Ânsfer params - Phone: ${phoneNumber}, CallSid: ${callSid}`);

        const result = await transferCallback({ phoneNumber, callSid, callerId, reason });

        if (!result) {
          return
        }

        return sendSuccess({
          message: 'Doorverbinden gestart',
          transferredTo: result.transferredTo ?? phoneNumber ?? null,
          callSid: result?.callSid ?? callSid ?? sessionCallSid ?? null,
          reason: reason ?? null,
        });
      },
      [TOOL_NAMES.checkGoogleCalendarAvailability]: async () => {
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â  === CHECK CALENDAR AVAILABILITY ===`);

        const date = this.normalizeStringArg(args['date']);
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âuested date: ${date}`);
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â args:`, args);

        if (!date) {
          throw new Error('Ontbrekende datum voor agenda beschikbaarheid.');
        }

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âting business hours for date...`);
        const { openHour, closeHour } = this.getBusinessHoursForDate(config, date);
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âiness hours: ${openHour}:00 - ${closeHour}:00`);

        const staffPreference = this.resolveStaffPreference(config, args, sessionContext);
        const staffCalendarMap = this.buildStaffCalendarMap(config);
        const calendarIdsToQuery = staffPreference.calendarId
          ? [staffPreference.calendarId]
          : (staffCalendarMap.size > 0 ? Array.from(staffCalendarMap.keys()) : null);

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âff preference`, {
          staffMemberId: staffPreference.staffMember?.id ?? null,
          staffMemberName: staffPreference.staffMember?.name ?? null,
          explicitCalendarId: staffPreference.explicitCalendarId,
          resolvedCalendarId: staffPreference.calendarId ?? null,
          calendarIdsToQuery,
        });

        try {
          const availabilityResult = await this.getAvailabilityWithCache(
            companyId,
            date,
            openHour,
            closeHour,
            calendarIdsToQuery,
          );

          if (availabilityResult.durationMs > 0) {
            console.log(
              `[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âgle availability resolved in ${availabilityResult.durationMs}ms (${availabilityResult.source})`,
            );
          } else {
            console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âng cached availability result`);
          }

          const { availability, availableRanges, perCalendarRanges } = availabilityResult;
          const isCacheHit = availabilityResult.source === 'cache';

          const calendarMeta = new Map<string, CalendarAvailabilityCalendar>();
          (availability.calendars ?? []).forEach((calendar) => {
            if (calendar?.calendarId) {
              calendarMeta.set(calendar.calendarId, calendar);
            }
          });

          const perCalendarAvailability = Object.entries(perCalendarRanges).map(([calendarId, ranges]) => {
            const meta = calendarMeta.get(calendarId) ?? null;
            const staff = staffCalendarMap.get(calendarId) ?? [];
            return {
              calendarId,
              calendarSummary: meta?.summary ?? null,
              staffMembers: staff.map((member) => ({ id: member.id, name: member.name })),
              availableRanges: ranges,
            };
          });

          console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Ây intervals:`, availability.busy);
          console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âived available ranges:`, availableRanges);

          const busyCount = availability.busy.length;
          const availableCount = availableRanges.length;
          const message = busyCount === 0
            ? 'Geen afspraken gepland: de volledige dag is beschikbaar.'
            : availableCount === 0
              ? 'Alle tijden binnen het venster zijn bezet.'
              : `Beschikbaarheid gevonden in ${availableCount} vrije blok${availableCount === 1 ? '' : 'ken'}.`;

          if (sessionRef) {
            this.updateSessionStaffPreference(sessionRef, sessionContext, {
              staffMember: staffPreference.staffMember,
              calendarId: staffPreference.calendarId ?? calendarIdsToQuery?.[0] ?? null,
            });
          }

          return sendSuccess({
            date,
            openHour,
            closeHour,
            operatingWindow: availability.operatingWindow,
            busy: availability.busy,
            availableRanges,
            perCalendarAvailability,
            selectedStaffMemberId: staffPreference.staffMember?.id ?? null,
            selectedStaffMemberName: staffPreference.staffMember?.name ?? null,
            selectedCalendarId: staffPreference.calendarId ?? null,
            cached: isCacheHit,
            sharedRequest: availabilityResult.source === 'pending' ? true : undefined,
            retrievalDurationMs: availabilityResult.durationMs,
            calendarIdsQueried: calendarIdsToQuery,
            message,
          });
        } catch (error) {
          console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âor getting beschikbaarheid:', error);
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
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‹Å“ === SCHEDULE CALENDAR EVENT ===`);

        const summary = this.normalizeStringArg(args['summary']);
        const start = this.normalizeStringArg(args['start']);
        const end = this.normalizeStringArg(args['end']);
        const sessionCallerName = this.normalizeStringArg(sessionContext?.callerName);
        const name = this.normalizeStringArg(args['name']) ?? sessionCallerName;
        const description = this.normalizeStringArg(args['description']);
        const location = this.normalizeStringArg(args['location']);
        const providedPhoneNumber = this.normalizeStringArg(args['phoneNumber']);
        const sessionPhoneNumber = this.normalizeStringArg(sessionContext?.callerNumber);
        const rawPhoneNumber = providedPhoneNumber ?? sessionPhoneNumber ?? null;
        const phoneNumber = this.normalizePhoneNumber(rawPhoneNumber);

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Ânt params:`, {
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

        const staffPreference = this.resolveStaffPreference(config, args, sessionContext);
        const staffCalendarMap = this.buildStaffCalendarMap(config);
        let selectedCalendarId = staffPreference.calendarId ?? null;
        let assignedStaff = staffPreference.staffMember ?? null;

        const candidateCalendarIds = selectedCalendarId
          ? [selectedCalendarId]
          : (staffCalendarMap.size > 0 ? Array.from(staffCalendarMap.keys()) : []);

        if (!selectedCalendarId && candidateCalendarIds.length > 0) {
          try {
            const calendarSelection = await this.googleService.findFirstAvailableCalendar(
              companyId,
              start,
              end,
              candidateCalendarIds,
            );
            if (calendarSelection) {
              selectedCalendarId = calendarSelection.calendarId;
              console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âected calendar ${selectedCalendarId} (${calendarSelection.summary ?? 'unknown'}) for booking.`);
              const staffForCalendar = staffCalendarMap.get(calendarSelection.calendarId) ?? [];
              if (!assignedStaff && staffForCalendar.length > 0) {
                assignedStaff = staffForCalendar[0];
              }
            }
          } catch (selectionError) {
            console.warn('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âled to resolve calendar availability', selectionError);
          }
        }

        if (!selectedCalendarId && candidateCalendarIds.length > 0) {
          selectedCalendarId = candidateCalendarIds[0];
        }

        if (!assignedStaff && selectedCalendarId) {
          const staffForCalendar = staffCalendarMap.get(selectedCalendarId);
          if (staffForCalendar && staffForCalendar.length > 0) {
            assignedStaff = staffForCalendar[0];
          }
        }

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âendar assignment`, {
          candidateCalendarIds,
          selectedCalendarId,
          assignedStaffId: assignedStaff?.id ?? null,
          assignedStaffName: assignedStaff?.name ?? null,
        });

        if (phoneNumber) {
          try {
            console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âsisting caller ${phoneNumber} (${name})`);
            await this.companyService.createCompanyCaller(companyId, { name, phoneNumber });
          } catch (error) {
            console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âled to persist caller info', error);
          }
        } else {
          console.log('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âphone number provided; skipping caller persistence.');
        }

        const details: string[] = [];
        if (description) details.push(description);
        details.push(`Naam: ${name}`);
        if (phoneNumber) details.push(`Telefoonnummer: ${phoneNumber}`);
        if (assignedStaff) details.push(`Medewerker: ${assignedStaff.name}`);
        if (selectedCalendarId) details.push(`Agenda: ${selectedCalendarId}`);
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
        if (assignedStaff) {
          privateProperties.staffMemberId = String(assignedStaff.id);
          privateProperties.staffMemberName = assignedStaff.name;
        }
        if (selectedCalendarId) {
          privateProperties.googleCalendarId = selectedCalendarId;
        }

        event.extendedProperties = { private: privateProperties };

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âating event in calendar ${selectedCalendarId ?? 'primary'}...`);
        const created = await this.googleService.scheduleEvent(companyId, event, {
          calendarId: selectedCalendarId ?? undefined,
        });
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Ânt created:`, created.id);

        if (sessionRef) {
          this.updateSessionStaffPreference(sessionRef, sessionContext, {
            staffMember: assignedStaff,
            calendarId: selectedCalendarId,
          });
        }

        return sendSuccess({
          event: created,
        });
      },
      [TOOL_NAMES.cancelGoogleCalendarEvent]: async () => {
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¦Ãƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ === CANCEL CALENDAR EVENT ===`);

        const start = this.normalizeStringArg(args['start'] ?? args['startTime']);
        const sessionCallerName = this.normalizeStringArg(sessionContext?.callerName);
        const name = this.normalizeStringArg(args['name']) ?? sessionCallerName;
        const phoneNumber = this.normalizeStringArg(args['phoneNumber']);
        const reason = this.normalizeStringArg(args['reason']);

        const staffPreference = this.resolveStaffPreference(config, args, sessionContext);
        const staffCalendarMap = this.buildStaffCalendarMap(config);
        const calendarIdsToQuery = staffPreference.calendarId
          ? [staffPreference.calendarId]
          : (staffCalendarMap.size > 0 ? Array.from(staffCalendarMap.keys()) : null);

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âcel params:`, {
          start,
          name,
          phoneNumber,
          reason,
          calendarIdsToQuery,
        });

        if (!start || !phoneNumber) {
          throw new Error('Ontbrekende starttijd of telefoonnummer om te annuleren.');
        }

        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âling GoogleService.cancelEvent...`);
        if (calendarIdsToQuery && calendarIdsToQuery.length > 0) {
          await this.googleService.cancelEvent(
            companyId,
            start,
            phoneNumber,
            name ?? undefined,
            { calendarIds: calendarIdsToQuery },
          );
        } else {
          await this.googleService.cancelEvent(
            companyId,
            start,
            phoneNumber,
            name ?? undefined,
          );
        }
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Ânt cancelled`);

        if (sessionRef) {
          this.updateSessionStaffPreference(sessionRef, sessionContext, {
            staffMember: staffPreference.staffMember,
            calendarId: staffPreference.calendarId ?? null,
          });
        }

        return sendSuccess({
          start,
          cancelled: true,
          reason: reason ?? null,
          calendarIdsQueried: calendarIdsToQuery,
        });
      },
      [TOOL_NAMES.getProductDetailsByName]: async () => {
        console.log(`[VapiClient] 🛒 === GET PRODUCT DETAILS BY NAME ===`);
        const storeId = this.normalizeStoreId(args['storeId']);
        const productName = this.normalizeStringArg(args['productName']);

        if (!storeId) {
          throw new Error('storeId is verplicht (shopify of woocommerce).');
        }
        if (!productName) {
          throw new Error('productName is verplicht.');
        }

        console.log(`[VapiClient] Product lookup`, { storeId, productName, companyId: companyId.toString() });

        const service = this.resolveCommerceService(storeId);
        try {
          const result = await service.getProductByName(companyId, productName);
          return sendSuccess({
            storeId,
            product: {
              id: result.id,
              name: (result as any).title ?? (result as any).name ?? null,
              raw: (result as any).raw ?? result,
            },
          });
        } catch (error) {
          console.error(`[VapiClient] 🛒 product lookup failed`, { storeId, productName, error });
          throw error;
        }
      },
      [TOOL_NAMES.getOrderStatus]: async () => {
        console.log(`[VapiClient] 🧾 === GET ORDER STATUS ===`);
        const storeId = this.normalizeStoreId(args['storeId']);
        const orderIdRaw = args['orderId'];
        const orderId =
          typeof orderIdRaw === 'string' ? orderIdRaw.trim() : typeof orderIdRaw === 'number' ? orderIdRaw.toString() : '';

        if (!storeId) {
          throw new Error('storeId is verplicht (shopify of woocommerce).');
        }
        if (!orderId) {
          throw new Error('orderId is verplicht.');
        }

        console.log(`[VapiClient] Order status lookup`, { storeId, orderId, companyId: companyId.toString() });

        const service = this.resolveCommerceService(storeId);
        try {
          const result = await service.getOrderStatus(companyId, orderId);
          return sendSuccess({
            storeId,
            order: {
              id: result.id,
              status: (result as any).status ?? null,
              raw: (result as any).raw ?? result,
            },
          });
        } catch (error) {
          console.error(`[VapiClient] 🧾 order status lookup failed`, { storeId, orderId, error });
          throw error;
        }
      },
      [TOOL_NAMES.fetchProductInfo]: async () => {
        const productIdRaw = this.normalizeStringArg(args['productId']);
        if (!productIdRaw) {
          throw new Error('productId is verplicht om productinformatie op te halen.');
        }

        const productId = Number(productIdRaw);
        if (Number.isNaN(productId)) {
          return sendError('Ongeldig productId ontvangen.', { productId: productIdRaw });
        }

        const product = await this.productKnowledgeService.getProduct(companyId, productId);
        if (!product) {
          return sendError('Dit product is niet gevonden in de kennisbank.', { productId });
        }

        const payload = {
          productId: product.id.toString(),
          name: product.name,
          sku: product.sku,
          summary: product.summary ?? product.content.summary ?? null,
          synonyms: product.synonyms,
          status: product.status,
          version: product.version,
          updatedAt: product.updatedAt.toISOString(),
          content: product.content,
        };

        return sendSuccess(payload);
      },
    };

    const handler = normalizedToolName ? handlers[normalizedToolName] : undefined;

    if (!handler) {
      console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â No handler found!`);
      console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âking for: ${normalizedToolName}`);
      console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âilable handlers:`, Object.keys(handlers));
      return sendError(`Onbekende tool: ${call.name}`);
    }

    console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â» Handler found, executing...`);

    try {
      const handlerResult = await handler();
      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Handler completed with result:`, handlerResult);

      if (!payloadWasSet && handlerResult) {
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âng handler return value as payload`);
        finalPayload = handlerResult;
        this.recordToolResponse(call.id, handlerResult, normalizedToolName);
      } else if (!payloadWasSet) {
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âdler returned no result, setting finalPayload to null`);
        finalPayload = null;
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message || `Onbekende fout bij uitvoeren van ${call.name}`
          : `Onbekende fout bij uitvoeren van ${call.name}`;
      console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Handler threw error:`, error);
      return sendError(message, error);
    }

    if (!finalPayload) {
      console.error(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â CRITICAL: No payload was set after execution!`);
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
    calendarIds: string[] | null,
  ): Promise<{
    availability: CalendarAvailability;
    availableRanges: AvailableRange[];
    perCalendarRanges: Record<string, AvailableRange[]>;
    source: 'fresh' | 'cache' | 'pending';
    durationMs: number;
  }> {
    const normalizedIds = calendarIds
      ?.map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);
    const uniqueOrderedIds = normalizedIds
      ? normalizedIds.filter((id, index) => normalizedIds.indexOf(id) === index)
      : null;
    const key = this.buildAvailabilityCacheKey(
      companyId,
      date,
      openHour,
      closeHour,
      uniqueOrderedIds,
    );
    const now = Date.now();
    const cached = this.availabilityCache.get(key);

    if (cached) {
      if (cached.expiresAt > now) {
        return {
          availability: cached.availability,
          availableRanges: cached.availableRanges,
          perCalendarRanges: cached.perCalendarRanges,
          source: 'cache',
          durationMs: 0,
        };
      }

      this.availabilityCache.delete(key);
    }

    const pending = this.availabilityPending.get(key);
    if (pending) {
      console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â?Ãƒâ€šÃ‚Â´ÃƒÂ¢Ã¢â‚¬ÂÃ‚ÂÃƒâ€šÃ‚Â¢ Awaiting in-flight availability request for ${key}`);
      const result = await pending.promise;
      return {
        availability: result.availability,
        availableRanges: result.availableRanges,
        perCalendarRanges: result.perCalendarRanges,
        source: 'pending',
        durationMs: Date.now() - pending.startedAt,
      };
    }

    const startedAt = Date.now();
    const availabilityPromise = (async () => {
      const availability = uniqueOrderedIds && uniqueOrderedIds.length > 0
        ? await this.googleService.getAvailableSlots(
            companyId,
            date,
            openHour,
            closeHour,
            { calendarIds: uniqueOrderedIds },
          )
        : await this.googleService.getAvailableSlots(
            companyId,
            date,
            openHour,
            closeHour,
          );

      const perCalendarRanges: Record<string, AvailableRange[]> = {};
      const calendarEntries = availability.calendars ?? [];
      for (const calendar of calendarEntries) {
        const calendarId = this.normalizeStringArg(calendar?.calendarId) ?? null;
        if (!calendarId) continue;
        perCalendarRanges[calendarId] = this.deriveAvailableRangesFromBusy(
          availability.operatingWindow,
          calendar.busy ?? [],
        );
      }

      const rangeSets = Object.values(perCalendarRanges);
      const availableRanges =
        rangeSets.length > 0
          ? this.mergeAvailableRanges(rangeSets)
          : this.deriveAvailableRanges(availability);

      return {
        availability,
        availableRanges,
        perCalendarRanges,
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
        perCalendarRanges: result.perCalendarRanges,
        expiresAt: Date.now() + this.availabilityCacheTtlMs,
      });
      return {
        availability: result.availability,
        availableRanges: result.availableRanges,
        perCalendarRanges: result.perCalendarRanges,
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
    calendarIds: string[] | null,
  ): string {
    const calendarKey = calendarIds && calendarIds.length > 0 ? calendarIds.slice().sort().join('~') : 'default';
    return [companyId.toString(), date, openHour, closeHour, calendarKey].join('|');
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
        console.warn(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Operation timed out after ${timeoutMs}ms`);
        clear();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });

    return guardedPromise;
  }

  public async handleToolWebhookRequest(
    body: unknown,
  ): Promise<{ results: Array<{ toolCallId: string; result?: any; error?: any }> }> {
    console.log('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã¢â‚¬Â° Received tool webhook payload');
    logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â¥ Tool webhook payload', body, PAYLOAD_LOG_LIMIT);

    const raw = body as Record<string, unknown> | null | undefined;
    const callId = VapiClient.extractCallIdFromWebhook(raw);
    const rawToolCall = this.extractToolCallPayload(raw);
    const normalized = this.normalizeToolCall(rawToolCall);
    const fallbackToolCallId = this.extractToolCallId(raw);
    const toolCallId = normalized?.id ?? fallbackToolCallId ?? `tool_${Date.now()}`;
    console.log(
      '[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã¢â‚¬Å¾ Extracted webhook context',
      {
        callId: callId ?? '<none>',
        normalizedName: normalized?.name ?? '<unknown>',
        normalizedId: normalized?.id ?? '<none>',
        fallbackToolCallId: fallbackToolCallId ?? '<none>',
        finalToolCallId: toolCallId,
      },
    );

    if (!normalized) {
      console.warn('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Unable to normalize tool call payload');

      // ÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â¼ÃƒÆ’Ã‚Â§Ãƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ IMPORTANT: pull the real id from message.* and echo it back
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
      '[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¬ Session lookup result',
      {
        callId: callId ?? '<none>',
        sessionFound: Boolean(sessionInfo),
        activeTrackedCallIds: Array.from(this.activeSessionsByCallId.keys()),
        totalActiveSessions: this.activeSessionsByCallId.size,
      },
    );
    if (!sessionInfo) {
      let registryContext: { callSid: string | null; config: VapiAssistantConfig | null } | null = null;
      if (callId) {
        registryContext = await this.loadSessionContextFromRegistry(callId);
        if (registryContext?.config) {
          try {
            const payload =
              (await this.executeToolCall(normalized, {
                session: null,
                callbacks: null,
                callSid: registryContext.callSid,
                config: registryContext.config,
              })) ?? { success: false, error: 'Tool execution returned empty result.' };

            logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Âª Tool execution payload (registry session)', payload);
            const response = { results: [{ toolCallId: normalized.id, result: payload }] };
            logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool webhook response (registry session)', response);
            return response;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Tool execution failed for registry session.';
            console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Registry-backed tool execution failed', {
              callId,
              error,
            });
            const payload = { success: false, error: message };
            this.recordToolResponse(toolCallId, payload, this.normalizeToolName(normalized.name));
            const response = { results: [{ toolCallId, result: payload }] };
            logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool webhook response (registry session error)', response);
            return response;
          }
        }
      }

      // Try to find session by any available callId in the active sessions
      let fallbackSessionInfo: { session: VapiRealtimeSession; callbacks: VapiRealtimeCallbacks; callSid: string } | undefined;

      if (this.activeSessionsByCallId.size > 0) {
        // If we have active sessions but no matching callId, use the first available session
        const firstCallId = Array.from(this.activeSessionsByCallId.keys())[0];
        fallbackSessionInfo = this.activeSessionsByCallId.get(firstCallId);
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â¤ Using fallback session for callId: ${firstCallId}`);
      }

      const sessionToUse = sessionInfo || fallbackSessionInfo;

      if (!sessionToUse) {
        const recorded = this.toolResponseLog.get(toolCallId);
        if (recorded?.payload) {
          console.log(
            `[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Returning cached tool response for ${toolCallId} (no active session)`,
          );
          const response = { results: [{ toolCallId, result: recorded.payload }] };
          logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool webhook response (from cache)', response);
          return response;
        }
        const payload = {
          success: false,
          error: callId
            ? `Geen actieve Vapi-sessie gevonden voor callId ${callId} ${Array.from(this.activeSessionsByCallId.keys())}.`
            : 'Geen actieve Vapi-sessie beschikbaar voor tool webhook.',
        };
        this.recordToolResponse(toolCallId, payload, this.normalizeToolName(normalized.name));
        const response = { results: [{ toolCallId, result: payload }] };
        logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool webhook response (no session)', response);
        return response;
      }

      // Use the fallback session
      const payload =
        await this.executeToolCall(normalized, {
          session: sessionToUse.session,
          callbacks: sessionToUse.callbacks,
          callSid: sessionToUse.callSid,
        })
        ?? { success: false, error: 'Tool execution returned empty result.' };

      logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Âª Tool execution payload (fallback session)', payload);
      const response = { results: [{ toolCallId: normalized.id, result: payload }] };
      logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool webhook response (fallback session)', response);
      return response;
    }

    const payload =
      await this.executeToolCall(normalized, {
        session: sessionInfo.session,
        callbacks: sessionInfo.callbacks,
        callSid: sessionInfo.callSid,
      })
      ?? { success: false, error: 'Tool execution returned empty result.' };

    // IMPORTANT: return the RAW payload object (not stringified, not just a message)
    logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Âª Tool execution payload', payload);
    const response = { results: [{ toolCallId: normalized.id, result: payload }] };
    logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Tool webhook response (success)', response);
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
        console.log(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã‚Â£ Evicting cached tool response ${oldestKey}`);
        this.toolResponseLog.delete(oldestKey);
      }
    }

    console.log('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Recording tool response', {
      toolCallId,
      normalizedName: normalizedName ?? '<unknown>',
    });
    logPayload('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÆ’Ã‚Â©Ãƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Tool response payload (cached)', payload);
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
        '[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒÂ¢Ã¢â‚¬Â¢Ã¢â‚¬â€ Removing active session for callId',
        context.callId,
      );
      this.activeSessionsByCallId.delete(context.callId);
      void this.sessionRegistry
        .unregisterSession(context.callId)
        .catch((error) =>
          console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âled to unregister session from registry', {
            callId: context.callId,
            error,
          }),
        );
    }
    this.sessionContexts.delete(session);
  }

  private async persistSharedSession(callId: string, callSid: string) {
    try {
      const config = this.getConfigForCall(callSid);
      await this.sessionRegistry.registerSession({
        callId,
        callSid,
        workerId: this.workerId,
        config,
      });
    } catch (error) {
      console.error(`[${callSid}] [Vapi] Failed to persist session mapping`, error);
    }
  }

  private async loadSessionContextFromRegistry(
    callId: string,
  ): Promise<{ callSid: string | null; config: VapiAssistantConfig | null }> {
    try {
      const record = await this.sessionRegistry.findSession(callId);
      if (!record) {
        console.warn(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â¡ No registry session found for callId=${callId}`);
        return { callSid: null, config: null };
      }

      const config = this.resolveConfigFromRecord(record);

      try {
        await this.sessionRegistry.registerSession({
          callId: record.callId,
          callSid: record.callSid ?? undefined,
          workerId: this.workerId,
          workerAddress: record.workerAddress ?? undefined,
          config,
        });
      } catch (error) {
        console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚ÂÃƒâ€šÃ‚Â´Ãƒâ€šÃ‚Â©ÃƒÆ’Ã¢â‚¬Â¦ Failed to refresh session TTL in registry', {
          callId,
          error,
        });
      }

      return {
        callSid: record.callSid ?? null,
        config,
      };
    } catch (error) {
      console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Failed to load session context from registry', { callId, error });
      return { callSid: null, config: null };
    }
  }

  private resolveConfigFromRecord(record: VapiSessionRecord): VapiAssistantConfig | null {
    const existingConfig = record.callSid ? this.getConfigForCall(record.callSid) : null;
    if (existingConfig) {
      return existingConfig;
    }

    if (record.configJson) {
      try {
        const parsed = JSON.parse(record.configJson) as VapiAssistantConfig;
        if (record.callSid) {
          this.sessionConfigs.set(record.callSid, parsed);
        } else {
          this.currentConfig = parsed;
        }
        return parsed;
      } catch (error) {
        console.error('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Â Failed to parse registry session config', {
          callId: record.callId,
          error,
        });
      }
    }

    return null;
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

  private normalizeStoreId(value: unknown): 'shopify' | 'woocommerce' | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'shopify' || normalized === 'woocommerce') {
      return normalized;
    }
    return null;
  }

  private resolveCommerceService(storeId: 'shopify' | 'woocommerce') {
    return storeId === 'shopify' ? this.shopifyService : this.wooService;
  }

  private getEffectiveCalendarProvider(config: VapiAssistantConfig): CalendarProvider | null {
    if (config.calendarProvider) {
      return config.calendarProvider;
    }
    return config.hasGoogleIntegration ? 'google' : null;
  }

  private isPhorestProvider(_config: VapiAssistantConfig): boolean {
    return false;
  }

  private getCalendarProviderName(provider: CalendarProvider | null): string {
    if (provider === 'google') {
      return 'Google';
    }
    return 'agenda';
  }

  private getCalendarProviderDescription(provider: CalendarProvider | null): string {
    const name = this.getCalendarProviderName(provider);
    if (!provider || name === 'agenda') {
      return 'de agenda';
    }
    return `de ${name} agenda`;
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
            `[VapiClient] assistant ${cachedId} for company ${assistantName} could not be updated; recreating.`,
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
            `[VapiClient] assistant ${existingId} for company ${assistantName} could not be updated; creating new.`,
            error,
          );
        }
      }

      const createdId = await this.createAssistant(payload);
      this.assistantCache.set(cacheKey, createdId);
      return createdId;
    } catch (error: unknown) {
      this.logAxiosError(
        `[VapiClient] led to sync assistant for company ${assistantName}`,
        error,
        payload,
      );
      throw error;
    }
  }

  private buildAssistantPayload(config: VapiAssistantConfig) {
    const instructions = this.buildSystemPrompt(config);
    const companyContext = this.buildCompanySnapshot(config);
    console.log(
      `[VapiClient] Building assistant payload for company: ${config.company.name}, Google integration: ${config.hasGoogleIntegration}, commerce stores: ${(config.commerceStores ?? []).join(",") || "none"}`,
    );
    const tools = this.getTools(
      config.hasGoogleIntegration,
      config.calendarProvider,
      config.commerceStores ?? [],
    );
    console.log(
      `[VapiClient] tools ready (${tools.length}):`,
      tools.map((tool) => tool.function?.name || 'unknown'),
    );

    const modelMessages = this.buildModelMessages(instructions, companyContext, config);

    const payload: Record<string, unknown> = {
      name: this.getAssistantName(config),
      transcriber: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
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
      commerceStores: config.commerceStores ?? [],
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
      this.logAxiosError(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âled to find assistant '${name}'`, error, undefined, 'warn');
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
      this.logAxiosError('[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âled to create assistant', error, payload);
      throw error;
    }
  }

  private async updateAssistant(id: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.http.patch(this.buildApiPath(`/assistant/${id}`), payload);
    } catch (error) {
      this.logAxiosError(`[VapiClient] ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â‚¬â€ÃƒÂ¯Ã‚Â¸Ã‚Âled to update assistant ${id}`, error, payload);
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















