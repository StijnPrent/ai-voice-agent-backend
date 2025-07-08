// src/clients/GoogleCalendarClient.ts

import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { injectable } from "tsyringe";
import config from "../config/config";

export interface GoogleTokens {
    access_token: string;
    refresh_token: string;
    scope?: string;
    token_type?: string;
    expiry_date?: number;
}

@injectable()
export class GoogleCalendarClient {
    private getOauth2Client(): OAuth2Client {
        const { googleClientId, googleClientSecret, googleRedirectUri } = config;
        return new google.auth.OAuth2(
            googleClientId,
            googleClientSecret,
            googleRedirectUri
        );
    }

    getAuthUrl(companyId: string): string {
        return this.getOauth2Client().generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/calendar.events"],
            prompt: "consent",
            state: companyId.toString(),
        });
    }

    async exchangeCode(code: string): Promise<GoogleTokens> {
        const oauth2Client = this.getOauth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        return tokens as GoogleTokens;
    }

    async createEvent(tokens: GoogleTokens, event: calendar_v3.Schema$Event) {
        const oauth2Client = this.getOauth2Client();
        oauth2Client.setCredentials(tokens);
        const calendar = google.calendar({
            version: "v3",
            auth: oauth2Client,
        });
        return calendar.events.insert({
            calendarId: "primary",
            requestBody: event,
        });
    }

    async refreshTokens(tokens: GoogleTokens): Promise<GoogleTokens> {
        const oauth2Client = this.getOauth2Client();
        oauth2Client.setCredentials(tokens);
        const res = await oauth2Client.refreshAccessToken();
        const newTokens = res.credentials as GoogleTokens;
        return newTokens;
    }
}