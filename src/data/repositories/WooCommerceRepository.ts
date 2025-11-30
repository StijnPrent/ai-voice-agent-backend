import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { IWooCommerceRepository } from "../interfaces/IWooCommerceRepository";
import { WooCommerceIntegrationModel } from "../../business/models/WooCommerceIntegrationModel";

export class WooCommerceRepository extends BaseRepository implements IWooCommerceRepository {
    public async upsertIntegration(input: {
        companyId: bigint;
        storeUrl: string;
        encryptedConsumerKey: string;
        consumerKeyIv: string;
        consumerKeyTag: string;
        encryptedConsumerSecret: string;
        consumerSecretIv: string;
        consumerSecretTag: string;
        apiVersion: string;
    }): Promise<void> {
        const sql = `
            INSERT INTO woocommerce_integrations (
                company_id,
                store_url,
                encrypted_consumer_key,
                consumer_key_iv,
                consumer_key_tag,
                encrypted_consumer_secret,
                consumer_secret_iv,
                consumer_secret_tag,
                api_version,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                store_url = VALUES(store_url),
                encrypted_consumer_key = VALUES(encrypted_consumer_key),
                consumer_key_iv = VALUES(consumer_key_iv),
                consumer_key_tag = VALUES(consumer_key_tag),
                encrypted_consumer_secret = VALUES(encrypted_consumer_secret),
                consumer_secret_iv = VALUES(consumer_secret_iv),
                consumer_secret_tag = VALUES(consumer_secret_tag),
                api_version = VALUES(api_version),
                updated_at = NOW()
        `;
        await this.execute<ResultSetHeader>(sql, [
            input.companyId,
            input.storeUrl,
            input.encryptedConsumerKey,
            input.consumerKeyIv,
            input.consumerKeyTag,
            input.encryptedConsumerSecret,
            input.consumerSecretIv,
            input.consumerSecretTag,
            input.apiVersion,
        ]);
    }

    public async deleteIntegration(companyId: bigint): Promise<void> {
        const sql = `DELETE FROM woocommerce_integrations WHERE company_id = ?`;
        await this.execute<ResultSetHeader>(sql, [companyId]);
    }

    public async getIntegration(companyId: bigint): Promise<WooCommerceIntegrationModel | null> {
        const sql = `
            SELECT
                company_id,
                store_url,
                encrypted_consumer_key,
                consumer_key_iv,
                consumer_key_tag,
                encrypted_consumer_secret,
                consumer_secret_iv,
                consumer_secret_tag,
                api_version,
                created_at,
                updated_at
            FROM woocommerce_integrations
            WHERE company_id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (!rows.length) return null;
        const row = rows[0];
        return new WooCommerceIntegrationModel(
            BigInt(row.company_id),
            row.store_url,
            row.encrypted_consumer_key,
            row.consumer_key_iv,
            row.consumer_key_tag,
            row.encrypted_consumer_secret,
            row.consumer_secret_iv,
            row.consumer_secret_tag,
            row.api_version,
            row.created_at ?? null,
            row.updated_at ?? null
        );
    }
}
