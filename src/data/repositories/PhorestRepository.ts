import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { IPhorestRepository } from "../interfaces/IPhorestRepository";
import { PhorestIntegrationModel } from "../../business/models/PhorestIntegrationModel";

const PHOREST_INTEGRATION_ID = 3;

export class PhorestRepository extends BaseRepository implements IPhorestRepository {
    public async upsertIntegration(
        companyId: bigint,
        businessId: string,
        branchId: string,
        username: string,
        encryptedPassword: string,
        passwordIv: string,
        passwordTag: string
    ): Promise<void> {
        const sql = `
            INSERT INTO phorest_integrations (
                company_id,
                business_id,
                branch_id,
                username,
                encrypted_password,
                password_iv,
                password_tag,
                integration_id,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                business_id = VALUES(business_id),
                branch_id = VALUES(branch_id),
                username = VALUES(username),
                encrypted_password = VALUES(encrypted_password),
                password_iv = VALUES(password_iv),
                password_tag = VALUES(password_tag),
                updated_at = NOW()
        `;
        await this.execute<ResultSetHeader>(sql, [
            companyId,
            businessId,
            branchId,
            username,
            encryptedPassword,
            passwordIv,
            passwordTag,
            PHOREST_INTEGRATION_ID
        ]);
    }

    public async fetchIntegration(companyId: bigint): Promise<PhorestIntegrationModel | null> {
        const sql = `SELECT * FROM phorest_integrations WHERE company_id = ? LIMIT 1`;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (!rows.length) {
            return null;
        }
        const row = rows[0];
        return new PhorestIntegrationModel(
            row.id,
            BigInt(row.company_id),
            row.business_id,
            row.branch_id,
            row.username,
            row.encrypted_password,
            row.password_iv,
            row.password_tag,
            row.created_at,
            row.updated_at
        );
    }

    public async deleteIntegration(companyId: bigint): Promise<void> {
        await this.execute<ResultSetHeader>(`DELETE FROM phorest_integrations WHERE company_id = ?`, [companyId]);
    }
}
