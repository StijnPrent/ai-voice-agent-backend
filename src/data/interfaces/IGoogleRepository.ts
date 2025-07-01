import {GoogleIntegrationModel} from "../../business/models/GoogleIntegrationModel";

export interface IGoogleRepository {
    insertGoogleTokens(companyId: bigint,
                       clientId: string,
                       clientSecretHash: string,
                       accessTokenHash: string,
                       refreshTokenHash: string): Promise<void>;
    fetchGoogleTokens(companyId: bigint): Promise<GoogleIntegrationModel | null>;
}