import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { ICustomInstructionRepository } from "../interfaces/ICustomInstructionRepository";
import { CustomInstructionModel } from "../../business/models/CustomInstructionModel";

export class CustomInstructionRepository extends BaseRepository implements ICustomInstructionRepository {
    public async getByCompany(companyId: bigint): Promise<CustomInstructionModel[]> {
        const sql = `SELECT id, company_id, instruction, created_at FROM custom_instructions WHERE company_id = ? ORDER BY created_at DESC`;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        return rows.map(r => new CustomInstructionModel(
            r.id,
            BigInt(r.company_id),
            r.instruction,
            r.created_at ?? null
        ));
    }

    public async add(companyId: bigint, instruction: string): Promise<number> {
        const sql = `INSERT INTO custom_instructions (company_id, instruction, created_at) VALUES (?, ?, NOW())`;
        const res = await this.execute<ResultSetHeader>(sql, [companyId, instruction]);
        return res.insertId;
    }

    public async delete(companyId: bigint, id: number): Promise<void> {
        const sql = `DELETE FROM custom_instructions WHERE id = ? AND company_id = ?`;
        await this.execute<ResultSetHeader>(sql, [id, companyId]);
    }
}
