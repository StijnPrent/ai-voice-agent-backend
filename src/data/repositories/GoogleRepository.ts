// src/repositories/GoogleRepository.ts

import pool from "../../config/database";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { GoogleIntegrationModel } from "../../business/models/GoogleIntegrationModel";
import { IGoogleRepository } from "../interfaces/IGoogleRepository";

export class GoogleRepository implements IGoogleRepository {
    /**
     * Insert or update a Google Calendar integration for a company.
     * Uses ON DUPLICATE KEY UPDATE on company_id.
     */
    public async insertGoogleTokens(
        companyId: bigint,
        clientId: string,
        clientSecretHash: string,
        accessTokenHash: string,
        refreshTokenHash: string
    ): Promise<void> {
        const sql = `
            INSERT INTO google_calendar_integrations (
                company_id,
                client_id,
                client_secret_hash,
                access_token_hash,
                refresh_token_hash,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                                     client_id            = VALUES(client_id),
                                     client_secret_hash   = VALUES(client_secret_hash),
                                     access_token_hash    = VALUES(access_token_hash),
                                     refresh_token_hash   = VALUES(refresh_token_hash),
                                     updated_at           = NOW()
        `;

        const params = [
            companyId,
            clientId,
            clientSecretHash,
            accessTokenHash,
            refreshTokenHash,
        ];

        try {
            const [result] = await pool.query<ResultSetHeader>(sql, params);

            // Determine the record ID
            let id: number;
            if (result.insertId && result.affectedRows === 1) {
                id = result.insertId;
            } else {
                const [[{ id: existingId }]] = await pool.query<RowDataPacket[]>(
                    `SELECT id FROM google_calendar_integrations WHERE company_id = ? LIMIT 1`,
                    [companyId]
                );
                id = existingId;
            }
        } catch (err) {
            console.error("Error upserting Google integration:", err);
            throw new Error("Database error: could not upsert Google integration");
        }
    }

    /**
     * Fetch a Google Calendar integration by company ID.
     */
    public async fetchGoogleTokens(
        companyId: bigint
    ): Promise<GoogleIntegrationModel | null> {
        const sql = `
            SELECT * FROM google_calendar_integrations
            WHERE company_id = ?
                LIMIT 1
        `;

        try {
            const [rows] = await pool.query<RowDataPacket[]>(sql, [companyId]);
            if (rows.length === 0) {
                return null;
            }
            const row = rows[0];
            return new GoogleIntegrationModel(
                row.id,
                row.company_id,
                row.client_id,

                // client secret encryption triple
                row.encrypted_secret,
                row.secret_iv,
                row.secret_tag,

                // access token encryption triple
                row.encrypted_access,
                row.access_iv,
                row.access_tag,

                // refresh token encryption triple
                row.encrypted_refresh,
                row.refresh_iv,
                row.refresh_tag,

                // optional metadata
                row.scope,
                row.token_type,
                row.expiry_date,

                // timestamps
                row.created_at,
                row.updated_at
            );
        } catch (err) {
            console.error("Error fetching Google integration:", err);
            throw new Error("Database error: could not fetch Google integration");
        }
    }
}
