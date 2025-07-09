    // src/services/GoogleIntegrationService.ts

    import { injectable, inject } from "tsyringe";
    import { calendar_v3 } from "googleapis";
    import { IGoogleRepository } from "../../data/interfaces/IGoogleRepository";
    import { GoogleCalendarClient, GoogleAppCredentials } from "../../clients/GoogleCalenderClient";
    import config from "../../config/config";
    import {encrypt} from "../../utils/crypto";

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

            // Refresh token if it's expired
            if (model.expiryDate && model.expiryDate < Date.now()) {
                const newTokens = await this.gcalClient.refreshTokens(model, redirectUri);

                // Update the database with the new tokens
                await this.repo.updateGoogleTokens(
                    model.id,
                    newTokens.access_token,
                    newTokens.refresh_token,
                    newTokens.expiry_date
                );

                // Refetch the model to get the updated tokens for the createEvent call
                const updatedModel = await this.repo.fetchGoogleTokens(companyId);
                if (!updatedModel) {
                    throw new Error(`Failed to refetch Google integration for company ${companyId} after token refresh.`);
                }
                const res = await this.gcalClient.createEvent(updatedModel, redirectUri, event);
                return res.data;
            }

            const res = await this.gcalClient.createEvent(model, redirectUri, event);
            return res.data;
        }
    }