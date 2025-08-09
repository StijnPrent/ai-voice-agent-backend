
// src/data/repositories/OutlookRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { OutlookIntegrationModel } from "../../business/models/OutlookIntegrationModel";
import { IOutlookRepository } from "../interfaces/IOutlookRepository";
import { BaseRepository } from "./BaseRepository";

export class OutlookRepository extends BaseRepository implements IOutlookRepository {
    public async insertOutlookTokens(
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
            INSERT INTO outlook_calendar_integrations (
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
            scope, tokenType, expiryDate, 2
        ]);
    }

    public async fetchOutlookTokens(companyId: bigint): Promise<OutlookIntegrationModel | null> {
        const sql = "SELECT * FROM outlook_calendar_integrations WHERE company_id = ? LIMIT 1";
        const results = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (results.length === 0) {
            return null;
        }
        const row = results[0];
        return new OutlookIntegrationModel(
            row.id,
            row.company_id,
            row.client_id,
            // Encrypted client secret fields
            row.encrypted_secret,
            row.secret_iv,
            row.secret_tag,
            // Encrypted access token fields
            row.encrypted_access,
            row.access_iv,
            row.access_tag,
            // Encrypted refresh token fields
            row.encrypted_refresh,
            row.refresh_iv,
            row.refresh_tag,
            // OAuth metadata
            row.scope,
            row.token_type,
            row.expiry_date,
            row.created_at,
            row.updated_at
        );
    }

    public async updateOutlookTokens(
        id: number,
        encryptedAccess: string,
        accessIv: string,
        accessTag: string,
        encryptedRefresh: string | null,
        refreshIv: string | null,
        refreshTag: string | null,
        expiryDate?: number
    ): Promise<void> {
        const sql = `
            UPDATE outlook_calendar_integrations
            SET encrypted_access  = ?,
                access_iv         = ?,
                access_tag        = ?,
                encrypted_refresh = ?,
                refresh_iv        = ?,
                refresh_tag       = ?,
                expiry_date       = ?,
                updated_at        = NOW()
            WHERE integration_id   = ?
        `;
        await this.execute(sql, [
            encryptedAccess,
            accessIv,
            accessTag,
            encryptedRefresh,
            refreshIv,
            refreshTag,
            expiryDate ?? null,
            id,
        ]);
    }
}
