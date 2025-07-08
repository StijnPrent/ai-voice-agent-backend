// src/data/repositories/PasswordRepository.ts
import { IPasswordRepository } from "../interfaces/IPasswordRepository";
import { BaseRepository } from "./BaseRepository";
import { RowDataPacket } from "mysql2";

export class PasswordRepository extends BaseRepository implements IPasswordRepository {
    public async createPassword(companyId: bigint, passwordHash: string): Promise<void> {
        const sql = "INSERT INTO passwords (company_id, password_hash, created_at) VALUES (?, ?, NOW())";
        await this.execute(sql, [companyId, passwordHash]);
    }

    public async findCurrentPasswordByCompanyId(companyId: bigint): Promise<string | null> {
        const sql = "SELECT password_hash FROM passwords WHERE company_id = ? ORDER BY created_at DESC LIMIT 1";
        const results = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (results.length === 0) {
            return null;
        }
        return results[0].password_hash;
    }
}
