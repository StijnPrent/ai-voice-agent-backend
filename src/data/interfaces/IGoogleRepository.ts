import {GoogleIntegrationModel} from "../../business/models/GoogleIntegrationModel";

export interface IGoogleRepository {
    insertGoogleTokens(
        companyId: bigint,
        clientId: string,
        encryptedSecret: string,
        secretIv: string,
        secretTag: string,
        encryptedAccess: string,
        accessIv: string,
        accessTag: string,
        encryptedRefresh: string,
        refreshIv: string,
        refreshTag: string,
        scope?: string,
        tokenType?: string,
        expiryDate?: number,
    ): Promise<void>;
    fetchGoogleTokens(companyId: bigint): Promise<GoogleIntegrationModel | null>;
    updateGoogleTokens(id: number,
                       accessToken: string,
                       refreshToken: string,
                       expiryDate: number | undefined): Promise<void>
}