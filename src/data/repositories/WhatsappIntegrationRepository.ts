import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import {
    IWhatsappIntegrationRepository,
    UpsertWhatsappIntegrationInput,
    WhatsappIntegrationRecord,
} from "../interfaces/IWhatsappIntegrationRepository";
import { encrypt, decrypt } from "../../utils/crypto";

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
                encrypted_access_token LONGTEXT NOT NULL,
                access_iv VARCHAR(48) NOT NULL,
                access_tag VARCHAR(48) NOT NULL,
                encrypted_verify_token LONGTEXT NULL,
                verify_iv VARCHAR(48) NULL,
                verify_tag VARCHAR(48) NULL,
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
                encrypted_access_token,
                access_iv,
                access_tag,
                encrypted_verify_token,
                verify_iv,
                verify_tag,
                status,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                business_account_id = VALUES(business_account_id),
                phone_number_id     = VALUES(phone_number_id),
                encrypted_access_token = VALUES(encrypted_access_token),
                access_iv           = VALUES(access_iv),
                access_tag          = VALUES(access_tag),
                encrypted_verify_token = VALUES(encrypted_verify_token),
                verify_iv           = VALUES(verify_iv),
                verify_tag          = VALUES(verify_tag),
                status              = VALUES(status),
                updated_at          = NOW();
        `;

        const status = input.status ?? "active";
        const access = encrypt(input.accessToken);
        const verify = input.verifyToken ? encrypt(input.verifyToken) : null;
        await this.pool.query(sql, [
            input.companyId.toString(),
            input.businessAccountId,
            input.phoneNumberId,
            access.data,
            access.iv,
            access.tag,
            verify?.data ?? null,
            verify?.iv ?? null,
            verify?.tag ?? null,
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
                encrypted_access_token AS encryptedAccessToken,
                access_iv         AS accessIv,
                access_tag        AS accessTag,
                encrypted_verify_token AS encryptedVerifyToken,
                verify_iv         AS verifyIv,
                verify_tag        AS verifyTag,
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
                encrypted_access_token AS encryptedAccessToken,
                access_iv         AS accessIv,
                access_tag        AS accessTag,
                encrypted_verify_token AS encryptedVerifyToken,
                verify_iv         AS verifyIv,
                verify_tag        AS verifyTag,
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
        const accessToken = this.safeDecrypt(String(row.encryptedAccessToken), String(row.accessIv), String(row.accessTag));
        const verifyToken =
            row.encryptedVerifyToken && row.verifyIv && row.verifyTag
                ? this.safeDecrypt(String(row.encryptedVerifyToken), String(row.verifyIv), String(row.verifyTag))
                : null;

        return {
            companyId: BigInt(row.companyId),
            businessAccountId: String(row.businessAccountId),
            phoneNumberId: String(row.phoneNumberId),
            accessToken,
            verifyToken,
            status: (row.status as "active" | "disabled") ?? "active",
            createdAt: row.createdAt instanceof Date ? row.createdAt : null,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt : null,
        };
    }

    private safeDecrypt(data: string, iv: string, tag: string): string {
        try {
            return decrypt(data, iv, tag);
        } catch (error) {
            console.error("[WhatsappIntegrationRepository] Failed to decrypt token", error);
            return "";
        }
    }
}
