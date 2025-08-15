    // src/services/GoogleIntegrationService.ts

import { injectable, inject } from "tsyringe";
import { calendar_v3 } from "googleapis";
import { IGoogleRepository } from "../../data/interfaces/IGoogleRepository";
import { GoogleCalendarClient, GoogleAppCredentials } from "../../clients/GoogleCalenderClient";
import config from "../../config/config";
import {encrypt} from "../../utils/crypto";
import {addMinutes, format, isBefore, parseISO, roundToNearestMinutes} from "date-fns";

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

    async getAvailableSlots(companyId: bigint, date: string): Promise<string[]> {
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
        timeMin.setHours(9, 0, 0, 0);
        const timeMax = new Date(date);
        timeMax.setHours(17, 0, 0, 0);

        const freeBusyResponse = await this.gcalClient.getFreeBusy(refreshedModel, redirectUri, timeMin.toISOString(), timeMax.toISOString());
        const busySlots = freeBusyResponse.data.calendars?.primary.busy ?? [];

        const availableSlots: string[] = [];
        let currentTime = timeMin;

        while (isBefore(currentTime, timeMax)) {
            const slotEnd = addMinutes(currentTime, 30);
            const isBusy = busySlots.some(busy => {
                const busyStart = parseISO(busy.start!);
                const busyEnd = parseISO(busy.end!);
                return (isBefore(currentTime, busyEnd) && isBefore(busyStart, slotEnd));
            });

            if (!isBusy) {
                availableSlots.push(format(currentTime, "HH:mm"));
            }

            currentTime = slotEnd;
        }

        return availableSlots;
    }

    async cancelEvent(companyId: bigint, name: string, dateOfBirth: string, date: string): Promise<boolean> {
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
        timeMin.setHours(0, 0, 0, 0);

        const events = await this.gcalClient.listEvents(refreshedModel, redirectUri, timeMin.toISOString(), `name: ${name}`);
        if (!events.data.items) {
            return false;
        }

        for (const event of events.data.items) {
            if (event.description?.includes(`Date of Birth: ${dateOfBirth}`)) {
                await this.gcalClient.deleteEvent(refreshedModel, redirectUri, event.id!);
                return true;
            }
        }

        return false;
    }


    async disconnect(companyId: bigint): Promise<void> {
        await this.repo.deleteGoogleTokens(companyId);
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
                    throw new Error(`Google API 'invalid_grant': Re-authentication required for company ${model.companyId}.`);
                }
                throw error;
            }
        }
    }
}