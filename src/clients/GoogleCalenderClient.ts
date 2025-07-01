// src/clients/GoogleCalendarClient.ts

import { google, calendar_v3 } from "googleapis";
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
    oauth2Client: ReturnType<typeof google.auth.OAuth2>;
    private calendar: calendar_v3.Calendar;

    constructor(
        clientId: string,
        clientSecret: string
    ) {
        const { googleRedirectUri } = config;
        this.oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            googleRedirectUri
        );
        this.calendar = google.calendar({
            version: "v3",
            auth: this.oauth2Client,
        });
    }

    /**
     * Generate the URL to redirect the user to for Google OAuth consent,
     * including state for companyId.
     */
    getAuthUrl(companyId: string): string {
        return this.oauth2Client.generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/calendar.events"],
            prompt: "consent",
            state: companyId.toString(),
        });
    }

    /**
     * After the user consents, exchange the code for tokens.
     * Returns the tokens object, which you should persist.
     */
    async exchangeCode(code: string): Promise<GoogleTokens> {
        const { tokens } = await this.oauth2Client.getToken(code);
        this.oauth2Client.setCredentials(tokens);
        return tokens as GoogleTokens;
    }

    /**
     * Set existing credentials on the OAuth2 client (e.g. from DB).
     */
    setCredentials(tokens: GoogleTokens): void {
        this.oauth2Client.setCredentials(tokens);
    }

    /**
     * Create a calendar event in the user's primary calendar.
     */
    async createEvent(event: calendar_v3.Schema$Event) {
        return this.calendar.events.insert({
            calendarId: "primary",
            requestBody: event,
        });
    }

    /**
     * Refresh the access token if expired. Returns the new tokens object.
     */
    async refreshTokens(): Promise<GoogleTokens> {
        const res = await this.oauth2Client.refreshAccessToken();
        const newTokens = res.credentials as GoogleTokens;
        this.oauth2Client.setCredentials(newTokens);
        return newTokens;
    }
}
