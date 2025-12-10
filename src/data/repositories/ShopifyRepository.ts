import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { IShopifyRepository } from "../interfaces/IShopifyRepository";
import { ShopifyIntegrationModel } from "../../business/models/ShopifyIntegrationModel";

export class ShopifyRepository extends BaseRepository implements IShopifyRepository {
    public async upsertIntegration(input: {
        companyId: bigint;
        shopDomain: string;
        encryptedAccessToken: string;
        accessTokenIv: string;
        accessTokenTag: string;
        scopes?: string | null;
    }): Promise<void> {
        const sql = `
            INSERT INTO shopify_integrations (
                company_id,
                shop_domain,
                encrypted_access_token,
                access_token_iv,
                access_token_tag,
                scopes,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                shop_domain = VALUES(shop_domain),
                encrypted_access_token = VALUES(encrypted_access_token),
                access_token_iv = VALUES(access_token_iv),
                access_token_tag = VALUES(access_token_tag),
                scopes = VALUES(scopes),
                updated_at = NOW()
        `;
        await this.execute<ResultSetHeader>(sql, [
            input.companyId,
            input.shopDomain,
            input.encryptedAccessToken,
            input.accessTokenIv,
            input.accessTokenTag,
            input.scopes ?? null,
        ]);
    }

    public async deleteIntegration(companyId: bigint): Promise<void> {
        const sql = `DELETE FROM shopify_integrations WHERE company_id = ?`;
        await this.execute<ResultSetHeader>(sql, [companyId]);
    }

    public async getIntegration(companyId: bigint): Promise<ShopifyIntegrationModel | null> {
        const sql = `
            SELECT
                company_id,
                shop_domain,
                encrypted_access_token,
                access_token_iv,
                access_token_tag,
                scopes,
                created_at,
                updated_at
            FROM shopify_integrations
            WHERE company_id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (!rows.length) return null;
        const row = rows[0];
        return new ShopifyIntegrationModel(
            BigInt(row.company_id),
            row.shop_domain,
            row.encrypted_access_token,
            row.access_token_iv,
            row.access_token_tag,
            row.scopes ?? null,
            row.created_at ?? null,
            row.updated_at ?? null
        );
    }
}
