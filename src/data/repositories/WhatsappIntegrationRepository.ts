import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import {
    IWhatsappIntegrationRepository,
    UpsertWhatsappIntegrationInput,
    WhatsappIntegrationRecord,
} from "../interfaces/IWhatsappIntegrationRepository";

export class WhatsappIntegrationRepository
    extends BaseRepository
    implements IWhatsappIntegrationRepository
{
    private initialized = false;

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const createSql = `
            CREATE TABLE IF NOT EXISTS whatsapp_integrations (
                company_id BIGINT NOT NULL PRIMARY KEY,
                business_account_id VARCHAR(64) NOT NULL,
                phone_number_id VARCHAR(64) NOT NULL,
                access_token TEXT NOT NULL,
                verify_token VARCHAR(191) NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'active',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_phone_number_id (phone_number_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;

        await this.pool.query(createSql);
        this.initialized = true;
    }

    public async upsert(input: UpsertWhatsappIntegrationInput): Promise<void> {
        await this.ensureInitialized();

        const sql = `
            INSERT INTO whatsapp_integrations (
                company_id,
                business_account_id,
                phone_number_id,
                access_token,
                verify_token,
                status,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                business_account_id = VALUES(business_account_id),
                phone_number_id     = VALUES(phone_number_id),
                access_token        = VALUES(access_token),
                verify_token        = VALUES(verify_token),
                status              = VALUES(status),
                updated_at          = NOW();
        `;

        const status = input.status ?? "active";
        await this.pool.query(sql, [
            input.companyId.toString(),
            input.businessAccountId,
            input.phoneNumberId,
            input.accessToken,
            input.verifyToken ?? null,
            status,
        ]);
    }

    public async findByCompanyId(companyId: bigint): Promise<WhatsappIntegrationRecord | null> {
        await this.ensureInitialized();

        const sql = `
            SELECT
                company_id        AS companyId,
                business_account_id AS businessAccountId,
                phone_number_id   AS phoneNumberId,
                access_token      AS accessToken,
                verify_token      AS verifyToken,
                status            AS status,
                created_at        AS createdAt,
                updated_at        AS updatedAt
            FROM whatsapp_integrations
            WHERE company_id = ?
            LIMIT 1
        `;

        const [rows] = await this.pool.query<RowDataPacket[]>(sql, [companyId.toString()]);
        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }
        return this.mapRow(rows[0]);
    }

    public async findByPhoneNumberId(phoneNumberId: string): Promise<WhatsappIntegrationRecord | null> {
        await this.ensureInitialized();

        const sql = `
            SELECT
                company_id        AS companyId,
                business_account_id AS businessAccountId,
                phone_number_id   AS phoneNumberId,
                access_token      AS accessToken,
                verify_token      AS verifyToken,
                status            AS status,
                created_at        AS createdAt,
                updated_at        AS updatedAt
            FROM whatsapp_integrations
            WHERE phone_number_id = ?
            LIMIT 1
        `;

        const [rows] = await this.pool.query<RowDataPacket[]>(sql, [phoneNumberId]);
        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }
        return this.mapRow(rows[0]);
    }

    private mapRow(row: RowDataPacket): WhatsappIntegrationRecord {
        return {
            companyId: BigInt(row.companyId),
            businessAccountId: String(row.businessAccountId),
            phoneNumberId: String(row.phoneNumberId),
            accessToken: String(row.accessToken),
            verifyToken: row.verifyToken ? String(row.verifyToken) : null,
            status: (row.status as "active" | "disabled") ?? "active",
            createdAt: row.createdAt instanceof Date ? row.createdAt : null,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt : null,
        };
    }
}
