
// src/business/models/OutlookIntegrationModel.ts
import {decrypt} from "../../utils/crypto";

export class OutlookIntegrationModel {
    constructor(
        public readonly id: number,
        public readonly companyId: bigint,
        public readonly clientId: string,
        // Encrypted client secret
        private readonly encryptedSecret: string,
        private readonly secretIv: string,
        private readonly secretTag: string,
        // Encrypted access token
        private readonly encryptedAccess: string,
        private readonly accessIv: string,
        private readonly accessTag: string,
        // Encrypted refresh token
        private readonly encryptedRefresh: string,
        private readonly refreshIv: string,
        private readonly refreshTag: string,
        // OAuth metadata
        public readonly scope: string,
        public readonly tokenType: string,
        public readonly expiryDate: number,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}

    get clientSecret(): string {
        return decrypt(this.encryptedSecret, this.secretIv, this.secretTag);
    }

    get accessToken(): string {
        return decrypt(this.encryptedAccess, this.accessIv, this.accessTag);
    }

    get refreshToken(): string {
        return decrypt(this.encryptedRefresh, this.refreshIv, this.refreshTag);
    }
}
