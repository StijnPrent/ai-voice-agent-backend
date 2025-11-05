// src/services/GoogleIntegrationService.ts

import { inject, injectable } from "tsyringe";
import { calendar_v3 } from "googleapis";
import { parseISO, addMinutes } from "date-fns";

import { IGoogleRepository } from "../../data/interfaces/IGoogleRepository";
import { GoogleCalendarClient, GoogleAppCredentials } from "../../clients/GoogleCalenderClient";
import config from "../../config/config";
import { encrypt } from "../../utils/crypto";
import { GoogleReauthRequiredError } from "../errors/GoogleReauthRequiredError";
import { GoogleIntegrationModel } from "../models/GoogleIntegrationModel";

export type CalendarBusyInterval = { start: string; end: string };
export type CalendarAvailabilityWindow = { start: string; end: string };
export type CalendarAvailabilityCalendar = {
    calendarId: string;
    summary?: string | null;
    busy: CalendarBusyInterval[];
};
export type CalendarAvailability = {
    operatingWindow: CalendarAvailabilityWindow;
    busy: CalendarBusyInterval[];
    calendars?: CalendarAvailabilityCalendar[];
};

type NormalizedInterval = { start: number; end: number };

@injectable()
export class GoogleService {
    constructor(
        @inject("IGoogleRepository") private repo: IGoogleRepository,
        @inject(GoogleCalendarClient) private gcalClient: GoogleCalendarClient
    ) {}

    private getAppCredentials(): GoogleAppCredentials {
        const { googleClientId, googleClientSecret, googleRedirectUri } = config;
        if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
            throw new Error("Google application credentials are not configured.");
        }
        return {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            redirectUri: googleRedirectUri,
        };
    }

    private async getReadyIntegration(companyId: bigint): Promise<{ model: GoogleIntegrationModel; redirectUri: string }> {
        const model = await this.repo.fetchGoogleTokens(companyId);
        if (!model) {
            throw new Error(`No Google Calendar integration for company ${companyId}`);
        }

        const redirectUri = this.getAppCredentials().redirectUri;
        await this.refreshAndSaveTokens(model, redirectUri);

        const refreshedModel = await this.repo.fetchGoogleTokens(companyId);
        if (!refreshedModel) {
            throw new Error(`Failed to refetch Google integration for company ${companyId} after token refresh.`);
        }

        return {
            model: refreshedModel,
            redirectUri,
        };
    }

    getAuthUrl(companyId: string): string {
        const credentials = this.getAppCredentials();
        return this.gcalClient.getAuthUrl(credentials, companyId);
    }

    async connect(companyId: bigint, code: string): Promise<void> {
        const credentials = this.getAppCredentials();
        const tokens = await this.gcalClient.exchangeCode(credentials, code);

        const secretEnc = encrypt(credentials.clientSecret);
        const accessEnc = encrypt(tokens.access_token);
        const refreshEnc = encrypt(tokens.refresh_token);

        await this.repo.insertGoogleTokens(
            companyId,
            credentials.clientId,
            secretEnc.data,
            secretEnc.iv,
            secretEnc.tag,
            accessEnc.data,
            accessEnc.iv,
            accessEnc.tag,
            refreshEnc.data,
            refreshEnc.iv,
            refreshEnc.tag,
            tokens.scope,
            tokens.token_type,
            tokens.expiry_date
        );
    }

    async scheduleEvent(
        companyId: bigint,
        event: calendar_v3.Schema$Event,
        options?: { calendarId?: string | null }
    ): Promise<calendar_v3.Schema$Event> {
        const { model, redirectUri } = await this.getReadyIntegration(companyId);
        const res = await this.gcalClient.createEvent(
            model,
            redirectUri,
            event,
            options?.calendarId ?? undefined
        );
        return res.data;
    }

    async listCalendars(
        companyId: bigint
    ): Promise<
        {
            id: string;
            summary: string | null;
            description: string | null;
            timeZone: string | null;
            primary: boolean;
            selected: boolean;
            accessRole: string | null;
            backgroundColor: string | null;
        }[]
    > {
        const { model, redirectUri } = await this.getReadyIntegration(companyId);
        const response = await this.gcalClient.listCalendars(model, redirectUri);
        const items = response.data.items ?? [];

        return items
            .filter(
                (item): item is calendar_v3.Schema$CalendarListEntry & { id: string } =>
                    typeof item?.id === "string"
            )
            .map((item) => {
                const summaryOverride =
                    typeof item.summaryOverride === "string" && item.summaryOverride.trim().length > 0
                        ? item.summaryOverride.trim()
                        : null;
                const summary =
                    typeof item.summary === "string" && item.summary.trim().length > 0
                        ? item.summary.trim()
                        : null;
                const displayName = summaryOverride ?? summary ?? item.id!;

                return {
                    id: item.id!,
                    displayName,
                    summary,
                    summaryOverride,
                    description: item.description ?? null,
                    timeZone: item.timeZone ?? null,
                    primary: item.primary === true,
                    selected: item.selected === true,
                    accessRole: item.accessRole ?? null,
                    backgroundColor: item.backgroundColor ?? null,
                    foregroundColor: item.foregroundColor ?? null,
                    hidden: item.hidden === true,
                };
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName, "nl", { sensitivity: "base" }));
    }

    async getAvailableSlots(
        companyId: bigint,
        date: string,
        openHour: number,
        closeHour: number,
        options?: { calendarIds?: string[] | null }
    ): Promise<CalendarAvailability> {
        const { model, redirectUri } = await this.getReadyIntegration(companyId);

        const windowStart = new Date(date);
        windowStart.setHours(openHour, 0, 0, 0);
        const windowEnd = new Date(date);
        windowEnd.setHours(closeHour, 0, 0, 0);

        const timeMinIso = windowStart.toISOString();
        const timeMaxIso = windowEnd.toISOString();

        const calendarIds = (options?.calendarIds ?? [])
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            .map((id) => id.trim());

        const freeBusyResponse = await this.gcalClient.getFreeBusy(
            model,
            redirectUri,
            timeMinIso,
            timeMaxIso,
            calendarIds.length > 0 ? calendarIds : undefined
        );

        return this.buildAvailabilityFromFreeBusy(
            freeBusyResponse.data,
            windowStart,
            windowEnd,
            calendarIds.length > 0 ? calendarIds : undefined
        );
    }

    async findFirstAvailableCalendar(
        companyId: bigint,
        startIso: string,
        endIso: string,
        calendarIds: string[]
    ): Promise<{ calendarId: string; summary?: string | null } | null> {
        const candidates = calendarIds
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            .map((id) => id.trim());

        if (candidates.length === 0) {
            return null;
        }

        const { model, redirectUri } = await this.getReadyIntegration(companyId);
        const response = await this.gcalClient.getFreeBusy(
            model,
            redirectUri,
            startIso,
            endIso,
            candidates
        );

        const startMs = parseISO(startIso).getTime();
        const endMs = parseISO(endIso).getTime();
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
            throw new Error("Invalid start/end time for availability check.");
        }

        const calendars = response.data.calendars ?? {};
        for (const calendarId of candidates) {
            const entry = calendars[calendarId];
            const normalized = this.normalizeBusyIntervals(entry?.busy ?? [], startMs, endMs).numeric;
            const hasOverlap = normalized.some((interval) => interval.start < endMs && interval.end > startMs);
            if (!hasOverlap) {
                const summary =
                    entry && typeof (entry as any).summary === "string"
                        ? (entry as any).summary as string
                        : null;
                return {
                    calendarId,
                    summary,
                };
            }
        }

        return null;
    }

    async cancelEvent(
        companyId: bigint,
        startDateTime: string,
        phoneNumber: string,
        name?: string,
        options?: { calendarIds?: string[] | null }
    ): Promise<boolean> {
        const { model, redirectUri } = await this.getReadyIntegration(companyId);

        if (!startDateTime) {
            throw new Error("Missing event start time to cancel");
        }

        if (!phoneNumber) {
            throw new Error("Missing phone number to cancel");
        }

        let parsedStart: Date;
        try {
            parsedStart = parseISO(startDateTime);
        } catch {
            throw new Error("Invalid event start time format");
        }

        if (Number.isNaN(parsedStart.getTime())) {
            throw new Error("Invalid event start time format");
        }

        const normalizedTargetPhone = this.normalizePhoneNumber(phoneNumber);

        const windowStart = addMinutes(parsedStart, -60).toISOString();
        const windowEnd = addMinutes(parsedStart, 60).toISOString();

        const searchCalendars = (options?.calendarIds ?? [])
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
            .map((id) => id.trim());

        const calendarsToQuery = searchCalendars.length > 0 ? searchCalendars : ["primary"];

        for (const calendarId of calendarsToQuery) {
            console.log(
                `[GoogleService] Searching for events to cancel around ${startDateTime} with phone ${normalizedTargetPhone} in calendar ${calendarId}`
            );

            const eventsResponse = await this.gcalClient.listEvents(
                model,
                redirectUri,
                {
                    timeMin: windowStart,
                    timeMax: windowEnd,
                    q: normalizedTargetPhone,
                    maxResults: 10,
                },
                calendarId === "primary" ? undefined : calendarId
            );

            const items = eventsResponse.data.items ?? [];
            if (items.length === 0) {
                continue;
            }

            const matchingEvent = items.find((event) => {
                const eventStartIso = event.start?.dateTime ?? event.start?.date;
                if (!eventStartIso) {
                    return false;
                }

                let eventStart: Date;
                try {
                    eventStart = parseISO(eventStartIso);
                } catch {
                    return false;
                }

                if (Number.isNaN(eventStart.getTime())) {
                    return false;
                }

                const startDelta = Math.abs(eventStart.getTime() - parsedStart.getTime());
                if (startDelta > 15 * 60 * 1000) {
                    return false;
                }

                const eventPhone = this.extractPhoneNumber(event);
                if (!eventPhone) {
                    return false;
                }

                const normalizedEventPhone = this.normalizePhoneNumber(eventPhone);
                return normalizedEventPhone === normalizedTargetPhone;
            });

            if (matchingEvent && matchingEvent.id) {
                if (name || phoneNumber) {
                    console.log(
                        `[GoogleService] Cancel request verification data - name: ${name ?? "n/a"}, phone: ${phoneNumber}`
                    );
                }

                console.log(`[GoogleService] Cancelling event ${matchingEvent.id} from calendar ${calendarId}`);
                await this.gcalClient.deleteEvent(
                    model,
                    redirectUri,
                    matchingEvent.id,
                    calendarId === "primary" ? undefined : calendarId
                );
                return true;
            }
        }

        throw new Error("No matching event found to cancel");
    }

    async disconnect(companyId: bigint): Promise<void> {
        await this.repo.deleteGoogleTokens(companyId);
    }

    private buildAvailabilityFromFreeBusy(
        response: calendar_v3.Schema$FreeBusyResponse,
        windowStart: Date,
        windowEnd: Date,
        calendarOrder?: string[]
    ): CalendarAvailability {
        const windowStartMs = windowStart.getTime();
        const windowEndMs = windowEnd.getTime();

        const calendarsRaw = response.calendars ?? {};
        const entries = Object.entries(calendarsRaw);

        if (calendarOrder && calendarOrder.length > 0) {
            const orderMap = new Map(calendarOrder.map((id, index) => [id, index]));
            entries.sort((a, b) => {
                const indexA = orderMap.has(a[0]) ? orderMap.get(a[0])! : Number.MAX_SAFE_INTEGER;
                const indexB = orderMap.has(b[0]) ? orderMap.get(b[0])! : Number.MAX_SAFE_INTEGER;
                return indexA - indexB;
            });
        }

        const calendars: CalendarAvailabilityCalendar[] = [];
        const numericBusySets: NormalizedInterval[][] = [];

        for (const [calendarId, info] of entries) {
            const normalized = this.normalizeBusyIntervals(info?.busy ?? [], windowStartMs, windowEndMs);
            const summary =
                info && typeof (info as any).summary === "string"
                    ? (info as any).summary as string
                    : null;
            calendars.push({
                calendarId,
                summary,
                busy: normalized.iso,
            });
            numericBusySets.push(normalized.numeric);
        }

        const fullyBusy = this.computeFullyBusyIntervals(numericBusySets, windowStartMs, windowEndMs);

        return {
            operatingWindow: {
                start: windowStart.toISOString(),
                end: windowEnd.toISOString(),
            },
            busy: fullyBusy.map((interval) => ({
                start: new Date(interval.start).toISOString(),
                end: new Date(interval.end).toISOString(),
            })),
            calendars,
        };
    }

    private normalizeBusyIntervals(
        busy: calendar_v3.Schema$TimePeriod[] | null | undefined,
        windowStart: number,
        windowEnd: number
    ): { numeric: NormalizedInterval[]; iso: CalendarBusyInterval[] } {
        if (!busy || busy.length === 0) {
            return { numeric: [], iso: [] };
        }

        const numeric: NormalizedInterval[] = [];

        for (const interval of busy) {
            if (!interval.start || !interval.end) {
                continue;
            }

            const start = parseISO(interval.start).getTime();
            const end = parseISO(interval.end).getTime();

            if (Number.isNaN(start) || Number.isNaN(end)) {
                continue;
            }

            const clampedStart = Math.max(windowStart, start);
            const clampedEnd = Math.min(windowEnd, end);

            if (clampedEnd <= clampedStart) {
                continue;
            }

            numeric.push({ start: clampedStart, end: clampedEnd });
        }

        numeric.sort((a, b) => a.start - b.start);

        const merged: NormalizedInterval[] = [];
        for (const interval of numeric) {
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

        return {
            numeric: merged,
            iso: merged.map((interval) => ({
                start: new Date(interval.start).toISOString(),
                end: new Date(interval.end).toISOString(),
            })),
        };
    }

    private computeFullyBusyIntervals(
        busySets: NormalizedInterval[][],
        windowStart: number,
        windowEnd: number
    ): NormalizedInterval[] {
        if (busySets.length === 0) {
            return [];
        }

        const events: { time: number; delta: number }[] = [];
        busySets.forEach((set) => {
            set.forEach((interval) => {
                events.push({ time: interval.start, delta: +1 });
                events.push({ time: interval.end, delta: -1 });
            });
        });

        events.sort((a, b) => {
            if (a.time === b.time) {
                return b.delta - a.delta; // start (+1) before end (-1)
            }
            return a.time - b.time;
        });

        const result: NormalizedInterval[] = [];
        const required = busySets.length;
        let active = 0;
        let currentStart: number | null = null;

        for (const event of events) {
            const previousActive = active;
            active += event.delta;

            if (previousActive < required && active === required) {
                currentStart = Math.max(event.time, windowStart);
            } else if (previousActive === required && active < required && currentStart !== null) {
                const clampedEnd = Math.min(event.time, windowEnd);
                if (clampedEnd > currentStart) {
                    result.push({ start: currentStart, end: clampedEnd });
                }
                currentStart = null;
            }
        }

        if (currentStart !== null && currentStart < windowEnd) {
            result.push({ start: currentStart, end: windowEnd });
        }

        return result;
    }

    private normalizePhoneNumber(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) {
            return "";
        }

        const hasLeadingPlus = trimmed.startsWith("+");
        const digitsOnly = trimmed.replace(/[^0-9]/g, "");

        if (hasLeadingPlus) {
            return `+${digitsOnly}`;
        }

        if (digitsOnly.startsWith("00")) {
            return `+${digitsOnly.slice(2)}`;
        }

        if (digitsOnly.length === 10 && digitsOnly.startsWith("06")) {
            return `+31${digitsOnly.slice(1)}`;
        }

        if (digitsOnly.length === 9 && digitsOnly.startsWith("6")) {
            return `+31${digitsOnly}`;
        }

        return digitsOnly;
    }

    private extractPhoneNumber(event: calendar_v3.Schema$Event): string | null {
        const extendedPhone = event.extendedProperties?.private?.customerPhoneNumber;
        if (extendedPhone && extendedPhone.trim()) {
            return extendedPhone;
        }

        if (event.description) {
            const match = event.description.match(/Telefoonnummer:\s*([^\n]+)/i);
            if (match && match[1]?.trim()) {
                return match[1].trim();
            }
        }

        return null;
    }

    private async refreshAndSaveTokens(model: any, redirectUri: string): Promise<void> {
        if (!model.expiryDate || model.expiryDate < Date.now() + 60000) {
            try {
                console.log(`[GoogleService] Token for company ${model.companyId} requires refresh. Refreshing...`);
                const newTokens = await this.gcalClient.refreshTokens(model, redirectUri);

                const accessEnc = encrypt(newTokens.access_token);
                const refreshEnc = newTokens.refresh_token ? encrypt(newTokens.refresh_token) : null;

                await this.repo.updateGoogleTokens(
                    model.id,
                    accessEnc.data,
                    accessEnc.iv,
                    accessEnc.tag,
                    refreshEnc ? refreshEnc.data : null,
                    refreshEnc ? refreshEnc.iv : null,
                    refreshEnc ? refreshEnc.tag : null,
                    newTokens.expiry_date
                );
            } catch (error: any) {
                if (error.response?.data?.error === "invalid_grant") {
                    console.error(
                        `[GoogleService] 'invalid_grant' error for company ${model.companyId}. The refresh token is likely revoked or invalid. Please re-authenticate.`
                    );
                    const companyIdStr = model.companyId.toString();
                    const authUrl = this.getAuthUrl(companyIdStr);

                    try {
                        await this.repo.deleteGoogleTokens(BigInt(companyIdStr));
                    } catch (repoError) {
                        console.error(
                            `[GoogleService] Failed to remove invalid tokens for company ${companyIdStr}:`,
                            repoError
                        );
                    }

                    throw new GoogleReauthRequiredError(companyIdStr, authUrl);
                }
                throw error;
            }
        }
    }
}
