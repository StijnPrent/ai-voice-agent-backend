import { WooCommerceIntegrationModel } from "../../business/models/WooCommerceIntegrationModel";

export interface IWooCommerceRepository {
    upsertIntegration(input: {
        companyId: bigint;
        storeUrl: string;
        encryptedConsumerKey: string;
        consumerKeyIv: string;
        consumerKeyTag: string;
        encryptedConsumerSecret: string;
        consumerSecretIv: string;
        consumerSecretTag: string;
        apiVersion: string;
    }): Promise<void>;

    deleteIntegration(companyId: bigint): Promise<void>;

    getIntegration(companyId: bigint): Promise<WooCommerceIntegrationModel | null>;
}
