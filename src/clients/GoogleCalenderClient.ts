// src/clients/GoogleCalendarClient.ts

import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { injectable } from "tsyringe";
import { GoogleIntegrationModel } from "../business/models/GoogleIntegrationModel";

// This interface represents the raw token object returned by Google's API.
export interface GoogleTokens {
    access_token: string;
    refresh_token: string;
    scope?: string;
    token_type?: string;
    expiry_date?: number;
}

// This interface represents the application's static credentials, not a company's.
export interface GoogleAppCredentials {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

@injectable()
export class GoogleCalendarClient {
    private getOauth2Client(credentials: GoogleAppCredentials): OAuth2Client {
        return new google.auth.OAuth2(
            credentials.clientId,
            credentials.clientSecret,
            credentials.redirectUri
        );
    }

    getAuthUrl(credentials: GoogleAppCredentials, companyId: string): string {
        const SCOPES = ["https://www.googleapis.com/auth/calendar"];
        return this.getOauth2Client(credentials).generateAuthUrl({
            access_type: "offline",
            prompt: "consent",
            include_granted_scopes: false,
            scope: SCOPES,
            state: companyId.toString(),
        });
    }

    async exchangeCode(credentials: GoogleAppCredentials, code: string): Promise<GoogleTokens> {
        const oauth2Client = this.getOauth2Client(credentials);
        const { tokens } = await oauth2Client.getToken(code);

        const info = await oauth2Client.getTokenInfo(tokens.access_token!);
        console.log("[OAuth] Granted scopes:", info.scopes);

        const ok = info.scopes?.includes("https://www.googleapis.com/auth/calendar");
        if (!ok) {
            throw new Error(`Wrong scopes granted: ${info.scopes}. Expected calendar.`);
        }
        if (!tokens.refresh_token) {
            throw new Error("No refresh_token returned. Revoke old grant & re-consent with prompt=consent, access_type=offline.");
        }
        return tokens as GoogleTokens;
    }


    async createEvent(
        model: GoogleIntegrationModel,
        redirectUri: string,
        event: calendar_v3.Schema$Event,
        calendarId?: string
    ) {
        // Ensure the event title includes customer name and phone number
        try {
            const originalSummary = (event.summary ?? '').toString().trim();
            const priv = event.extendedProperties?.private as Record<string, string> | undefined;
            const customerName = priv?.customerName?.toString().trim();
            const customerPhone = priv?.customerPhoneNumber?.toString().trim();

            let suffix = '';
            if (customerName) {
                suffix += customerName;
            }
            if (customerPhone) {
                suffix += (suffix ? ' ' : '') + `(${customerPhone})`;
            }

            if (suffix) {
                if (!originalSummary) {
                    event.summary = suffix;
                } else if (!originalSummary.includes(suffix)) {
                    event.summary = `${originalSummary} - ${suffix}`;
                }
            }
        } catch (_) {
            // Non-fatal: if anything goes wrong, continue with the provided summary
        }
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({
            version: "v3",
            auth: oauth2Client,
        });
        return calendar.events.insert({
            calendarId: calendarId && calendarId.trim() ? calendarId.trim() : "primary",
            requestBody: event,
        });
    }

    async getFreeBusy(
        model: GoogleIntegrationModel,
        redirectUri: string,
        timeMin: string,
        timeMax: string,
        calendarIds?: string[]
    ) {
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const items =
            calendarIds && calendarIds.length > 0
                ? calendarIds
                      .filter((id) => typeof id === "string" && id.trim().length > 0)
                      .map((id) => ({ id: id.trim() }))
                : [{ id: "primary" }];
        return calendar.freebusy.query({
            requestBody: {
                timeMin,
                timeMax,
                timeZone: "Europe/Amsterdam",
                items,
            },
        });
    }

    async listEvents(
        model: GoogleIntegrationModel,
        redirectUri: string,
        options: { timeMin: string; timeMax?: string; q?: string; maxResults?: number },
        calendarId?: string
    ) {
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        return calendar.events.list({
            calendarId: calendarId && calendarId.trim() ? calendarId.trim() : "primary",
            timeMin: options.timeMin,
            timeMax: options.timeMax,
            q: options.q,
            maxResults: options.maxResults,
            singleEvents: true,
            orderBy: "startTime",
        });
    }

    async listCalendars(model: GoogleIntegrationModel, redirectUri: string) {
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        return calendar.calendarList.list({
            minAccessRole: "reader",
            maxResults: 250,
            showHidden: false,
        });
    }

    async deleteEvent(
        model: GoogleIntegrationModel,
        redirectUri: string,
        eventId: string,
        calendarId?: string
    ) {
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        return calendar.events.delete({
            calendarId: calendarId && calendarId.trim() ? calendarId.trim() : "primary",
            eventId,
        });
    }

    async refreshTokens(model: GoogleIntegrationModel, redirectUri: string): Promise<GoogleTokens> {
        const credentials = {
            clientId: model.clientId,
            clientSecret: model.clientSecret,
            redirectUri: redirectUri,
        };
        const oauth2Client = this.getOauth2Client(credentials);
        oauth2Client.setCredentials({
            access_token: model.accessToken,
            refresh_token: model.refreshToken,
            scope: model.scope,
            token_type: model.tokenType,
            expiry_date: model.expiryDate,
        });
        const res = await oauth2Client.refreshAccessToken();
        return res.credentials as GoogleTokens;
    }

    private getAuthenticatedClient(model: GoogleIntegrationModel, redirectUri: string): OAuth2Client {
        const credentials = {
            clientId: model.clientId,
            clientSecret: model.clientSecret,
            redirectUri: redirectUri,
        };
        const oauth2Client = this.getOauth2Client(credentials);
        oauth2Client.setCredentials({
            access_token: model.accessToken,
            refresh_token: model.refreshToken,
            scope: model.scope,
            token_type: model.tokenType,
            expiry_date: model.expiryDate,
        });
        return oauth2Client;
    }
}
