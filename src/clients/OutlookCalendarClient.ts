
// src/clients/OutlookCalendarClient.ts

import { Client } from "@microsoft/microsoft-graph-client";
import { ConfidentialClientApplication, OnBehalfOfRequest } from "@azure/msal-node";
import { injectable } from "tsyringe";
import { OutlookIntegrationModel } from "../business/models/OutlookIntegrationModel";
import "isomorphic-fetch";

// This interface represents the raw token object returned by Microsoft's API.
export interface OutlookTokens {
    access_token: string;
    refresh_token: string;
    scope?: string;
    token_type?: string;
    expires_in?: number;
}

// This interface represents the application's static credentials, not a company's.
export interface OutlookAppCredentials {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    tenantId: string;
}

@injectable()
export class OutlookCalendarClient {
    private getMsalClient(credentials: OutlookAppCredentials): ConfidentialClientApplication {
        const config = {
            auth: {
                clientId: credentials.clientId,
                authority: `https://login.microsoftonline.com/${credentials.tenantId}`,
                clientSecret: credentials.clientSecret,
            },
        };
        return new ConfidentialClientApplication(config);
    }

    getAuthUrl(credentials: OutlookAppCredentials, companyId: string): Promise<string> {
        const msalClient = this.getMsalClient(credentials);
        const authCodeUrlParameters = {
            scopes: ["calendars.readwrite", "offline_access"],
            redirectUri: credentials.redirectUri,
            state: companyId.toString(),
        };
        return msalClient.getAuthCodeUrl(authCodeUrlParameters);
    }

    async exchangeCode(credentials: OutlookAppCredentials, code: string): Promise<any> {
        const msalClient = this.getMsalClient(credentials);
        const tokenRequest = {
            code: code,
            scopes: ["calendars.readwrite", "offline_access"],
            redirectUri: credentials.redirectUri,
        };
        return await msalClient.acquireTokenByCode(tokenRequest);
    }

    async createEvent(model: OutlookIntegrationModel, redirectUri: string, event: any) {
        const credentials = {
            clientId: model.clientId,
            clientSecret: model.clientSecret,
            redirectUri: redirectUri,
            tenantId: "common",
        };
        const msalClient = this.getMsalClient(credentials);
        const client = Client.initWithMiddleware({
            authProvider: {
                getAccessToken: async () => {
                    return model.accessToken;
                },
            },
        });

        return await client.api("/me/events").post(event);
    }

    async refreshTokens(model: OutlookIntegrationModel): Promise<any> {
        const credentials = {
            clientId: model.clientId,
            clientSecret: model.clientSecret,
            redirectUri: "",
            tenantId: "common",
        };
        const msalClient = this.getMsalClient(credentials);
        const refreshTokenRequest = {
            refreshToken: model.refreshToken,
            scopes: ["calendars.readwrite", "offline_access"],
        };
        return await msalClient.acquireTokenByRefreshToken(refreshTokenRequest);
    }
}
