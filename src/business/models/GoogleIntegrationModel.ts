// src/models/GoogleIntegrationModel.ts

import { decrypt } from "../../utils/crypto";

export class GoogleIntegrationModel {
    constructor(
        private _id: number,
        private _companyId: number,
        private _clientId: string,

        // AES-GCM encrypted fields
        private _encryptedSecret: string,
        private _secretIv: string,
        private _secretTag: string,

        private _encryptedAccess: string,
        private _accessIv: string,
        private _accessTag: string,

        private _encryptedRefresh: string,
        private _refreshIv: string,
        private _refreshTag: string,

        // OAuth metadata
        private _scope?: string,
        private _tokenType?: string,
        private _expiryDate?: number,

        private _createdAt: Date = new Date(),
        private _updatedAt: Date = new Date()
    ) {}

    get id(): number {
        return this._id;
    }

    get companyId(): number {
        return this._companyId;
    }

    get clientId(): string {
        return this._clientId;
    }

    /** Decrypted client secret */
    get clientSecret(): string {
        return decrypt(this._encryptedSecret, this._secretIv, this._secretTag);
    }

    /** Decrypted access token */
    get accessToken(): string {
        return decrypt(this._encryptedAccess, this._accessIv, this._accessTag);
    }

    /** Decrypted refresh token */
    get refreshToken(): string {
        return decrypt(this._encryptedRefresh, this._refreshIv, this._refreshTag);
    }

    get scope(): string | undefined {
        return this._scope;
    }

    get tokenType(): string | undefined {
        return this._tokenType;
    }

    get expiryDate(): number | undefined {
        return this._expiryDate;
    }

    get createdAt(): Date {
        return this._createdAt;
    }

    get updatedAt(): Date {
        return this._updatedAt;
    }
}
