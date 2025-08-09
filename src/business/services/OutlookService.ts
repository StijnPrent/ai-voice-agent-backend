
// src/services/OutlookService.ts

import { injectable, inject } from "tsyringe";
import { IOutlookRepository } from "../../data/interfaces/IOutlookRepository";
import { OutlookCalendarClient, OutlookAppCredentials } from "../../clients/OutlookCalendarClient";
import config from "../../config/config";
import {encrypt} from "../../utils/crypto";

@injectable()
export class OutlookService {
    constructor(
        @inject("IOutlookRepository") private repo: IOutlookRepository,
        @inject(OutlookCalendarClient) private outlookClient: OutlookCalendarClient
    ) {}

    private getAppCredentials(): OutlookAppCredentials {
        const { outlookClientId, outlookClientSecret, outlookRedirectUri, outlookTenantId } = config;
        if (!outlookClientId || !outlookClientSecret || !outlookRedirectUri || !outlookTenantId) {
            throw new Error("Outlook application credentials are not configured.");
        }
        return {
            clientId: outlookClientId,
            clientSecret: outlookClientSecret,
            redirectUri: outlookRedirectUri,
            tenantId: outlookTenantId,
        };
    }

    async getAuthUrl(companyId: string): Promise<string> {
        const credentials = this.getAppCredentials();
        return this.outlookClient.getAuthUrl(credentials, companyId);
    }

    async connect(companyId: bigint, code: string): Promise<void> {
        const credentials = this.getAppCredentials();
        const tokens = await this.outlookClient.exchangeCode(credentials, code);

        // Encrypt each piece before persisting
        const secretEnc = encrypt(credentials.clientSecret);
        const accessEnc = encrypt(tokens.accessToken);
        const refreshEnc = encrypt(tokens.refreshToken);

        await this.repo.insertOutlookTokens(
            companyId,
            credentials.clientId,
            // encrypted client secret
            secretEnc.data, secretEnc.iv, secretEnc.tag,
            // encrypted access token
            accessEnc.data, accessEnc.iv, accessEnc.tag,
            // encrypted refresh token
            refreshEnc.data, refreshEnc.iv, refreshEnc.tag,
            tokens.scopes.join(" "),
            tokens.tokenType,
            tokens.expiresOn.getTime()
        );
    }

    async scheduleEvent(
        companyId: bigint,
        event: any
    ): Promise<any> {
        const model = await this.repo.fetchOutlookTokens(companyId);
        if (!model) {
            throw new Error(`No Outlook Calendar integration for company ${companyId}`);
        }

        const redirectUri = this.getAppCredentials().redirectUri;

        // Refresh token if it's expired or nearing expiry
        if (!model.expiryDate || model.expiryDate < (Date.now() + 60000)) { // 60-second buffer
            try {
                console.log(`[OutlookService] Token for company ${companyId} requires refresh. Refreshing...`);
                const newTokens = await this.outlookClient.refreshTokens(model);

                // Encrypt the new tokens before updating the database
                const accessEnc = encrypt(newTokens.accessToken);
                const refreshEnc = newTokens.refreshToken ? encrypt(newTokens.refreshToken) : null;

                await this.repo.updateOutlookTokens(
                    model.id,
                    accessEnc.data, accessEnc.iv, accessEnc.tag,
                    refreshEnc ? refreshEnc.data : null,
                    refreshEnc ? refreshEnc.iv : null,
                    refreshEnc ? refreshEnc.tag : null,
                    newTokens.expiresOn.getTime()
                );

                // Use the refreshed model for the createEvent call
                const refreshedModel = await this.repo.fetchOutlookTokens(companyId);
                if (!refreshedModel) {
                    throw new Error(`Failed to refetch Outlook integration for company ${companyId} after token refresh.`);
                }
                const res = await this.outlookClient.createEvent(refreshedModel, redirectUri, event);
                return res;

            } catch (error: any) {
                console.error(`[OutlookService] Error refreshing token for company ${companyId}:`, error);
                throw error;
            }
        }

        const res = await this.outlookClient.createEvent(model, redirectUri, event);
        return res;
    }
}
