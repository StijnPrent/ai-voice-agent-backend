// src/data/repositories/GoogleRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { GoogleIntegrationModel } from "../../business/models/GoogleIntegrationModel";
import { IGoogleRepository } from "../interfaces/IGoogleRepository";
import { BaseRepository } from "./BaseRepository";

export class GoogleRepository extends BaseRepository implements IGoogleRepository {
    public async insertGoogleTokens(
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
    ): Promise<void> {
        const sql = `
            INSERT INTO google_calendar_integrations (
                company_id,
                client_id,
                encrypted_secret, secret_iv, secret_tag,
                encrypted_access, access_iv, access_tag,
                encrypted_refresh, refresh_iv, refresh_tag,
                scope, token_type, expiry_date, integration_id,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                                     client_id        = VALUES(client_id),
                                     encrypted_secret= VALUES(encrypted_secret),
                                     secret_iv        = VALUES(secret_iv),
                                     secret_tag       = VALUES(secret_tag),
                                     encrypted_access = VALUES(encrypted_access),
                                     access_iv        = VALUES(access_iv),
                                     access_tag       = VALUES(access_tag),
                                     encrypted_refresh= VALUES(encrypted_refresh),
                                     refresh_iv       = VALUES(refresh_iv),
                                     refresh_tag      = VALUES(refresh_tag),
                                     scope            = VALUES(scope),
                                     token_type       = VALUES(token_type),
                                     expiry_date      = VALUES(expiry_date),
                                     updated_at       = NOW()
        `;
        await this.execute(sql, [
            companyId,
            clientId,
            encryptedSecret, secretIv, secretTag,
            encryptedAccess, accessIv, accessTag,
            encryptedRefresh, refreshIv, refreshTag,
            scope, tokenType, expiryDate, 1
        ]);
    }

    public async fetchGoogleTokens(companyId: bigint): Promise<GoogleIntegrationModel | null> {
        const sql = "SELECT * FROM google_calendar_integrations WHERE company_id = ? LIMIT 1";
        const results = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (results.length === 0) {
            return null;
        }
        const row = results[0];
        return new GoogleIntegrationModel(
            row.id,
            row.company_id,
            row.client_id,
            // Encrypted client secret fields
            row.encrypted_secret, // Corrected name
            row.secret_iv,        // Corrected name
            row.secret_tag,       // Corrected name
            // Encrypted access token fields
            row.encrypted_access, // Corrected name
            row.access_iv,        // Corrected name
            row.access_tag,       // Corrected name
            // Encrypted refresh token fields
            row.encrypted_refresh, // Corrected name
            row.refresh_iv,        // Corrected name
            row.refresh_tag,       // Corrected name
            // OAuth metadata
            row.scope,
            row.token_type,
            row.expiry_date,
            row.created_at,
            row.updated_at
        );
    }

    public async updateGoogleTokens(
        id: number,
        accessToken: string,
        refreshToken: string,
        expiryDate: number | undefined
    ): Promise<void> {
        const sql = `
            UPDATE google_calendar_integrations
            SET access_token = ?, refresh_token = ?, expiry_date = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute(sql, [accessToken, refreshToken, expiryDate, id]);
    }
}