import { decrypt } from "../../utils/crypto";

export class ShopifyIntegrationModel {
    constructor(
        private readonly _companyId: bigint,
        private readonly _shopDomain: string,
        private readonly _encryptedAccessToken: string,
        private readonly _accessTokenIv: string,
        private readonly _accessTokenTag: string,
        private readonly _scopes: string | null,
        private readonly _installedAt?: Date | null,
        private readonly _updatedAt?: Date | null
    ) {}

    get companyId(): bigint {
        return this._companyId;
    }

    get shopDomain(): string {
        return this._shopDomain;
    }

    get scopes(): string | null {
        return this._scopes;
    }

    get installedAt(): Date | null | undefined {
        return this._installedAt;
    }

    get updatedAt(): Date | null | undefined {
        return this._updatedAt;
    }

    get accessToken(): string {
        return decrypt(this._encryptedAccessToken, this._accessTokenIv, this._accessTokenTag);
    }
}
