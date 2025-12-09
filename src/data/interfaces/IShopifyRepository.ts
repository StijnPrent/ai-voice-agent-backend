import { ShopifyIntegrationModel } from "../../business/models/ShopifyIntegrationModel";

export interface IShopifyRepository {
    upsertIntegration(input: {
        companyId: bigint;
        shopDomain: string;
        encryptedAccessToken: string;
        accessTokenIv: string;
        accessTokenTag: string;
        scopes?: string | null;
    }): Promise<void>;

    deleteIntegration(companyId: bigint): Promise<void>;

    getIntegration(companyId: bigint): Promise<ShopifyIntegrationModel | null>;
}
