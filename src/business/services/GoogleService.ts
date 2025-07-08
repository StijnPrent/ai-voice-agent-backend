// src/services/GoogleIntegrationService.ts

import { injectable, inject } from "tsyringe";
import { calendar_v3 } from "googleapis";
import { IGoogleRepository } from "../../data/interfaces/IGoogleRepository";
import { GoogleCalendarClient, GoogleTokens } from "../../clients/GoogleCalenderClient";

@injectable()
export class GoogleService {
    constructor(
        @inject("IGoogleRepository") private repo: IGoogleRepository,
        @inject(GoogleCalendarClient) private gcalClient: GoogleCalendarClient
    ) {}

    getAuthUrl(companyId: string): string {
        return this.gcalClient.getAuthUrl(companyId);
    }

    async connect(companyId: bigint, code: string): Promise<void> {
        const tokens = await this.gcalClient.exchangeCode(code);

        await this.repo.insertGoogleTokens(
            companyId,
            process.env.GOOGLE_CLIENT_ID!,
            process.env.GOOGLE_CLIENT_SECRET!,
            tokens.access_token,
            tokens.refresh_token
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

        let tokens: GoogleTokens = {
            access_token:  model.accessToken,
            refresh_token: model.refreshToken,
            expiry_date: model.expiryDate,
            token_type: model.tokenType,
            scope: model.scope
        };

        if (model.expiryDate && model.expiryDate < Date.now()) {
            const newTokens = await this.gcalClient.refreshTokens(tokens);
            await this.repo.insertGoogleTokens(
                companyId,
                model.clientId,
                process.env.GOOGLE_CLIENT_SECRET!,
                newTokens.access_token,
                newTokens.refresh_token
            );
            tokens = newTokens;
        }

        const res = await this.gcalClient.createEvent(tokens, event);
        return res.data;
    }
}