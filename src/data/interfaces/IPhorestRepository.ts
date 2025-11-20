import { PhorestIntegrationModel } from "../../business/models/PhorestIntegrationModel";

export interface IPhorestRepository {
    upsertIntegration(
        companyId: bigint,
        businessId: string,
        branchId: string,
        username: string,
        encryptedPassword: string,
        passwordIv: string,
        passwordTag: string
    ): Promise<void>;

    fetchIntegration(companyId: bigint): Promise<PhorestIntegrationModel | null>;

    deleteIntegration(companyId: bigint): Promise<void>;
}
