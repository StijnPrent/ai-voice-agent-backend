import { BaseRepository } from "./BaseRepository";
import { CreateEarlyAccessRequest, IEarlyAccessRepository } from "../interfaces/IEarlyAccessRepository";
import { ResultSetHeader } from "mysql2";

export class EarlyAccessRepository extends BaseRepository implements IEarlyAccessRepository {
  public async createRequest(params: CreateEarlyAccessRequest): Promise<number> {
    const sql = `
      INSERT INTO early_access_requests
        (email, name, company, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', NOW(), NOW())
    `;

    const result = await this.execute<ResultSetHeader>(sql, [
      params.email,
      params.name ?? null,
      params.company ?? null,
    ]);

    return Number(result.insertId);
  }

  public async deleteByEmail(email: string): Promise<boolean> {
    const sql = `
      DELETE FROM early_access_requests
      WHERE email = ?
    `;
    const result = await this.execute<ResultSetHeader>(sql, [email]);
    return result.affectedRows > 0;
  }

  public async listRequests(): Promise<Array<{ email: string; name: string | null; company: string | null; createdAt: Date }>> {
    const sql = `
      SELECT email, name, company, created_at AS createdAt
      FROM early_access_requests
      ORDER BY created_at DESC
    `;
    const rows = await this.execute<any[]>(sql, []);
    return rows.map(row => ({
      email: row.email as string,
      name: row.name ?? null,
      company: row.company ?? null,
      createdAt: new Date(row.createdAt),
    }));
  }
}
