    // src/services/GoogleIntegrationService.ts

import { injectable, inject } from "tsyringe";
import { calendar_v3 } from "googleapis";
import { IGoogleRepository } from "../../data/interfaces/IGoogleRepository";
import { GoogleCalendarClient, GoogleAppCredentials } from "../../clients/GoogleCalenderClient";
import config from "../../config/config";
import {encrypt} from "../../utils/crypto";
import { parseISO, addMinutes } from "date-fns";
import { GoogleReauthRequiredError } from "../errors/GoogleReauthRequiredError";

export type CalendarBusyInterval = { start: string; end: string };
export type CalendarAvailabilityWindow = { start: string; end: string };
export type CalendarAvailability = {
    operatingWindow: CalendarAvailabilityWindow;
    busy: CalendarBusyInterval[];
};

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

    getAuthUrl(companyId: string): string {
        const credentials = this.getAppCredentials();
        return this.gcalClient.getAuthUrl(credentials, companyId);
    }

    async connect(companyId: bigint, code: string): Promise<void> {
        const credentials = this.getAppCredentials();
        const tokens = await this.gcalClient.exchangeCode(credentials, code);

        // Encrypt each piece before persisting
        const secretEnc = encrypt(credentials.clientSecret);
        const accessEnc = encrypt(tokens.access_token);
        const refreshEnc = encrypt(tokens.refresh_token);

        await this.repo.insertGoogleTokens(
            companyId,
            credentials.clientId,
            // encrypted client secret
            secretEnc.data, secretEnc.iv, secretEnc.tag,
            // encrypted access token
            accessEnc.data, accessEnc.iv, accessEnc.tag,
            // encrypted refresh token
            refreshEnc.data, refreshEnc.iv, refreshEnc.tag,
            tokens.scope,
            tokens.token_type,
            tokens.expiry_date
        );
    }

    async scheduleEvent(
        companyId: bigint,
        event: calendar_v3.Schema$Event
    ): Promise<calendar_v3.Schema$Event> {
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

        const res = await this.gcalClient.createEvent(refreshedModel, redirectUri, event);
        return res.data;
    }

    async getAvailableSlots(
        companyId: bigint,
        date: string,
        openHour: number,
        closeHour: number
    ): Promise<CalendarAvailability> {
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

        const timeMin = new Date(date);
        timeMin.setHours(openHour, 0, 0, 0);
        const timeMax = new Date(date);
        timeMax.setHours(closeHour, 0, 0, 0);

        const freeBusyResponse = await this.gcalClient.getFreeBusy(refreshedModel, redirectUri, timeMin.toISOString(), timeMax.toISOString());
        const busySlots = freeBusyResponse.data.calendars?.primary.busy ?? [];
        console.log("[FB] window", timeMin.toISOString(), "->", timeMax.toISOString());
        console.log("[FB] busy", busySlots);

        const operatingWindow: CalendarAvailabilityWindow = {
            start: timeMin.toISOString(),
            end: timeMax.toISOString(),
        };

        const windowStart = timeMin.getTime();
        const windowEnd = timeMax.getTime();

        const normalizedBusy = busySlots
            .map((busy) => {
                if (!busy.start || !busy.end) {
                    return null;
                }

                const rawStart = parseISO(busy.start).getTime();
                const rawEnd = parseISO(busy.end).getTime();

                if (Number.isNaN(rawStart) || Number.isNaN(rawEnd)) {
                    return null;
                }

                const clampedStart = Math.max(windowStart, rawStart);
                const clampedEnd = Math.min(windowEnd, rawEnd);

                if (clampedEnd <= clampedStart) {
                    return null;
                }

                return {
                    start: clampedStart,
                    end: clampedEnd,
                };
            })
            .filter((interval): interval is { start: number; end: number } => interval !== null)
            .filter((interval) => interval.end > windowStart && interval.start < windowEnd)
            .sort((a, b) => a.start - b.start)
            .reduce((merged: { start: number; end: number }[], interval) => {
                const last = merged[merged.length - 1];
                if (!last) {
                    merged.push({ ...interval });
                    return merged;
                }

                if (interval.start <= last.end) {
                    last.end = Math.max(last.end, interval.end);
                    return merged;
                }

                merged.push({ ...interval });
                return merged;
            }, []);

        const busy = normalizedBusy.map((interval) => ({
            start: new Date(interval.start).toISOString(),
            end: new Date(interval.end).toISOString(),
        }));

        return {
            operatingWindow,
            busy,
        };
    }

    async cancelEvent(
        companyId: bigint,
        startDateTime: string,
        phoneNumber: string,
        name?: string
    ): Promise<boolean> {
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

        console.log(
            `[GoogleService] Searching for events to cancel around ${startDateTime} with phone ${normalizedTargetPhone}`
        );

        const eventsResponse = await this.gcalClient.listEvents(refreshedModel, redirectUri, {
            timeMin: windowStart,
            timeMax: windowEnd,
            q: normalizedTargetPhone,
            maxResults: 10,
        });

        const items = eventsResponse.data.items ?? [];
        if (items.length === 0) {
            throw new Error("No matching event found to cancel");
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

        if (!matchingEvent || !matchingEvent.id) {
            throw new Error("No matching event found to cancel");
        }

        if (name || phoneNumber) {
            console.log(
                `[GoogleService] Cancel request verification data — name: ${name ?? "n/a"}, phone: ${phoneNumber}`
            );
        }

        console.log(`[GoogleService] Cancelling event ${matchingEvent.id}`);
        await this.gcalClient.deleteEvent(refreshedModel, redirectUri, matchingEvent.id);
        return true;
    }


    async disconnect(companyId: bigint): Promise<void> {
        await this.repo.deleteGoogleTokens(companyId);
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
        if (!model.expiryDate || model.expiryDate < (Date.now() + 60000)) { // 60-second buffer
            try {
                console.log(`[GoogleService] Token for company ${model.companyId} requires refresh. Refreshing...`);
                const newTokens = await this.gcalClient.refreshTokens(model, redirectUri);

                const accessEnc = encrypt(newTokens.access_token);
                const refreshEnc = newTokens.refresh_token ? encrypt(newTokens.refresh_token) : null;

                await this.repo.updateGoogleTokens(
                    model.id,
                    accessEnc.data, accessEnc.iv, accessEnc.tag,
                    refreshEnc ? refreshEnc.data : null,
                    refreshEnc ? refreshEnc.iv : null,
                    refreshEnc ? refreshEnc.tag : null,
                    newTokens.expiry_date
                );
            } catch (error: any) {
                if (error.response?.data?.error === 'invalid_grant') {
                    console.error(`[GoogleService] 'invalid_grant' error for company ${model.companyId}. The refresh token is likely revoked or invalid. Please re-authenticate.`);
                    const companyIdStr = model.companyId.toString();
                    const authUrl = this.getAuthUrl(companyIdStr);

                    try {
                        await this.repo.deleteGoogleTokens(BigInt(companyIdStr));
                    } catch (repoError) {
                        console.error(`[GoogleService] Failed to remove invalid tokens for company ${companyIdStr}:`, repoError);
                    }

                    throw new GoogleReauthRequiredError(companyIdStr, authUrl);
                }
                throw error;
            }
        }
    }
}