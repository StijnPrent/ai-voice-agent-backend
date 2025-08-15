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
        return this.getOauth2Client(credentials).generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/calendar"],
            prompt: "consent",
            state: companyId.toString(),
        });
    }

    async exchangeCode(credentials: GoogleAppCredentials, code: string): Promise<GoogleTokens> {
        const oauth2Client = this.getOauth2Client(credentials);
        const { tokens } = await oauth2Client.getToken(code);
        return tokens as GoogleTokens;
    }

    async createEvent(model: GoogleIntegrationModel, redirectUri: string, event: calendar_v3.Schema$Event) {
        console.log('Afspraak toevoegen');
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({
            version: "v3",
            auth: oauth2Client,
        });
        return calendar.events.insert({
            calendarId: "primary",
            requestBody: event,
        });
    }

    async getFreeBusy(model: GoogleIntegrationModel, redirectUri: string, timeMin: string, timeMax: string) {
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const info = await oauth2Client.getTokenInfo(
            (oauth2Client.credentials.access_token as string)
        );
        console.log("[GCal] token scopes =>", info.scopes);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        return calendar.freebusy.query({
            requestBody: {
                timeMin,
                timeMax,
                items: [{ id: "primary" }],
            },
        });
    }

    async listEvents(model: GoogleIntegrationModel, redirectUri: string, timeMin: string, q: string) {
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        return calendar.events.list({
            calendarId: "primary",
            timeMin,
            q,
            singleEvents: true,
            orderBy: "startTime",
        });
    }

    async deleteEvent(model: GoogleIntegrationModel, redirectUri: string, eventId: string) {
        const oauth2Client = this.getAuthenticatedClient(model, redirectUri);
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        return calendar.events.delete({
            calendarId: "primary",
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
        const newTokens = res.credentials as GoogleTokens;
        return newTokens;
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
