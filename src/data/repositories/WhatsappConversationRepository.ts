import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import {
    IWhatsappConversationRepository,
    WhatsappMessageRecord,
} from "../interfaces/IWhatsappConversationRepository";

export class WhatsappConversationRepository
    extends BaseRepository
    implements IWhatsappConversationRepository
{
    private initialized = false;

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const createSql = `
            CREATE TABLE IF NOT EXISTS whatsapp_conversations (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                company_id BIGINT NOT NULL,
                customer_number VARCHAR(64) NOT NULL,
                messages_json LONGTEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_company_customer (company_id, customer_number),
                INDEX idx_updated_at (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;

        await this.pool.query(createSql);
        this.initialized = true;
    }

    public async getConversation(companyId: bigint, customerNumber: string): Promise<WhatsappMessageRecord[]> {
        await this.ensureInitialized();

        const sql = `
            SELECT messages_json AS messagesJson
            FROM whatsapp_conversations
            WHERE company_id = ? AND customer_number = ?
            LIMIT 1
        `;

        const [rows] = await this.pool.query<RowDataPacket[]>(sql, [companyId.toString(), customerNumber]);
        if (!Array.isArray(rows) || rows.length === 0) {
            return [];
        }

        const raw = rows[0]?.messagesJson;
        if (typeof raw !== "string") {
            return [];
        }

        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed as WhatsappMessageRecord[];
            }
            return [];
        } catch {
            return [];
        }
    }

    public async saveConversation(
        companyId: bigint,
        customerNumber: string,
        messages: WhatsappMessageRecord[]
    ): Promise<void> {
        await this.ensureInitialized();

        const sql = `
            INSERT INTO whatsapp_conversations (company_id, customer_number, messages_json, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                messages_json = VALUES(messages_json),
                updated_at    = NOW()
        `;

        await this.pool.query(sql, [
            companyId.toString(),
            customerNumber,
            JSON.stringify(messages),
        ]);
    }

    public async clearConversation(companyId: bigint, customerNumber: string): Promise<void> {
        await this.ensureInitialized();
        const sql = `DELETE FROM whatsapp_conversations WHERE company_id = ? AND customer_number = ?`;
        await this.pool.query(sql, [companyId.toString(), customerNumber]);
    }
}
