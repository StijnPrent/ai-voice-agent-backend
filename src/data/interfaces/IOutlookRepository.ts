
// src/data/interfaces/IOutlookRepository.ts

import { OutlookIntegrationModel } from "../../business/models/OutlookIntegrationModel";

export interface IOutlookRepository {
    insertOutlookTokens(
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
        expiryDate?: number
    ): Promise<void>;

    fetchOutlookTokens(companyId: bigint): Promise<OutlookIntegrationModel | null>;

    updateOutlookTokens(
        id: number,
        encryptedAccess: string,
        accessIv: string,
        accessTag: string,
        encryptedRefresh: string | null,
        refreshIv: string | null,
        refreshTag: string | null,
        expiryDate?: number
    ): Promise<void>;
}
