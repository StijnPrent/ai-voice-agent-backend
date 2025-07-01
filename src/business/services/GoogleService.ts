// src/services/GoogleIntegrationService.ts

import { injectable, inject } from "tsyringe";
import { calendar_v3 } from "googleapis";
import { IGoogleRepository } from "../../data/interfaces/IGoogleRepository";
import { GoogleCalendarClient } from "../../clients/GoogleCalenderClient";

@injectable()
export class GoogleService {
    constructor(
        @inject("IGoogleRepository") private repo: IGoogleRepository,
        @inject("GoogleCalendarClient") private gcalClient: GoogleCalendarClient
    ) {}

    /**
     * Step 1: Generate the Google OAuth consent URL with state=companyId
     */
    getAuthUrl(companyId: string): string {
        return this.gcalClient.getAuthUrl(companyId);
    }

    /**
     * After the user completes OAuth, exchange the code for tokens,
     * persist them via the repository, and return the saved model.
     */
    async connect(companyId: bigint, code: string): Promise<void> {
        // 1) Exchange the code for tokens
        const tokens = await this.gcalClient.exchangeCode(code);

        // 2) Insert or update the tokens in the DB
        //    clientSecretHash here can be your env‐stored client secret (hashed/encrypted as needed)
        const model = await this.repo.insertGoogleTokens(
            companyId,
            process.env.GOOGLE_CLIENT_ID!,
            process.env.GOOGLE_CLIENT_SECRET!,
            tokens.access_token,
            tokens.refresh_token
        );

        return model;
    }

    /**
     * Schedule a calendar event for the given company.
     * - Loads the stored integration row
     * - Decrypts/uses the tokens via the model getters
     * - Refreshes tokens if expired (and upserts the new ones)
     * - Calls Google’s API to create the event
     */
    async scheduleEvent(
        companyId: bigint,
        event: calendar_v3.Schema$Event
    ): Promise<calendar_v3.Schema$Event> {
        // 1) Fetch the saved integration
        const model = await this.repo.fetchGoogleTokens(companyId);
        if (!model) {
            throw new Error(`No Google Calendar integration for company ${companyId}`);
        }

        // 2) Set credentials on the OAuth2 client
        this.gcalClient.oauth2Client.setCredentials({
            access_token:  model.accessToken,
            refresh_token: model.refreshToken,
        });

        // 3) If the access token is expired, refresh and persist
        if (model.expiryDate && model.expiryDate < Date.now()) {
            const newTokens = await this.gcalClient.refreshTokens();
            await this.repo.insertGoogleTokens(
                companyId,
                model.clientId,
                process.env.GOOGLE_CLIENT_SECRET!,
                newTokens.access_token,
                newTokens.refresh_token
            );
            // re‐set fresh credentials
            this.gcalClient.oauth2Client.setCredentials(newTokens);
        }

        // 4) Finally, create the event
        const res = await this.gcalClient.createEvent(event);
        return res.data;
    }
}
