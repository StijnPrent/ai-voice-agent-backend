import { decrypt } from "../../utils/crypto";

export class WooCommerceIntegrationModel {
    constructor(
        private readonly _companyId: bigint,
        private readonly _storeUrl: string,
        private readonly _encryptedConsumerKey: string,
        private readonly _consumerKeyIv: string,
        private readonly _consumerKeyTag: string,
        private readonly _encryptedConsumerSecret: string,
        private readonly _consumerSecretIv: string,
        private readonly _consumerSecretTag: string,
        private readonly _apiVersion: string,
        private readonly _connectedAt?: Date | null,
        private readonly _updatedAt?: Date | null
    ) {}

    get companyId(): bigint {
        return this._companyId;
    }

    get storeUrl(): string {
        return this._storeUrl;
    }

    get apiVersion(): string {
        return this._apiVersion;
    }

    get connectedAt(): Date | null | undefined {
        return this._connectedAt;
    }

    get updatedAt(): Date | null | undefined {
        return this._updatedAt;
    }

    get consumerKey(): string {
        return decrypt(this._encryptedConsumerKey, this._consumerKeyIv, this._consumerKeyTag);
    }

    get consumerSecret(): string {
        return decrypt(this._encryptedConsumerSecret, this._consumerSecretIv, this._consumerSecretTag);
    }
}
