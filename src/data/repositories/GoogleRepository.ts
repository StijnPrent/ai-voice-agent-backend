// src/data/repositories/GoogleRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { GoogleIntegrationModel } from "../../business/models/GoogleIntegrationModel";
import { IGoogleRepository } from "../interfaces/IGoogleRepository";
import { BaseRepository } from "./BaseRepository";

export class GoogleRepository extends BaseRepository implements IGoogleRepository {
    public async insertGoogleTokens(
        companyId: bigint,
        clientId: string,
        clientSecret: string,
        accessToken: string,
        refreshToken: string
    ): Promise<void> {
        const sql = `
            INSERT INTO google_calendar_integrations (
                company_id, client_id, client_secret, access_token, refresh_token, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                client_id = VALUES(client_id),
                client_secret = VALUES(client_secret),
                access_token = VALUES(access_token),
                refresh_token = VALUES(refresh_token),
                updated_at = NOW()
        `;
        await this.execute(sql, [companyId, clientId, clientSecret, accessToken, refreshToken]);
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
            row.client_secret,
            row.access_token,
            row.refresh_token,
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