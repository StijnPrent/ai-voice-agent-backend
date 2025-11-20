import { BaseRepository } from "./BaseRepository";
import {
  AuthTokenRecord,
  CreateAuthTokenParams,
  IAuthTokenRepository,
  AuthTokenType,
} from "../interfaces/IAuthTokenRepository";
import { RowDataPacket, ResultSetHeader } from "mysql2";

export class AuthTokenRepository extends BaseRepository implements IAuthTokenRepository {
  public async createToken(params: CreateAuthTokenParams): Promise<number> {
    const sql = `
      INSERT INTO auth_tokens
        (company_id, token_hash, token_type, metadata, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    `;

    const result = await this.execute<ResultSetHeader>(sql, [
      params.companyId,
      params.tokenHash,
      params.type,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.expiresAt,
    ]);
    return Number(result.insertId);
  }

  public async findValidToken(type: AuthTokenType, tokenHash: string): Promise<AuthTokenRecord | null> {
    const sql = `
      SELECT id, company_id AS companyId, token_hash AS tokenHash, token_type AS tokenType,
             metadata, expires_at AS expiresAt, consumed_at AS consumedAt
      FROM auth_tokens
      WHERE token_type = ?
        AND token_hash = ?
        AND consumed_at IS NULL
        AND expires_at > NOW()
      ORDER BY id DESC
      LIMIT 1
    `;

    const rows = await this.execute<RowDataPacket[]>(sql, [type, tokenHash]);
    if (!rows.length) {
      return null;
    }

    const row = rows[0];
    return {
      id: Number(row.id),
      companyId: BigInt(row.companyId),
      tokenHash: String(row.tokenHash),
      type,
      expiresAt: new Date(row.expiresAt),
      consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  public async markConsumed(tokenId: number): Promise<void> {
    const sql = `
      UPDATE auth_tokens
      SET consumed_at = NOW(), updated_at = NOW()
      WHERE id = ?
    `;
    await this.execute(sql, [tokenId]);
  }

  public async invalidateTokens(companyId: bigint, type: AuthTokenType): Promise<void> {
    const sql = `
      UPDATE auth_tokens
      SET consumed_at = NOW(), updated_at = NOW()
      WHERE company_id = ?
        AND token_type = ?
        AND consumed_at IS NULL
    `;
    await this.execute(sql, [companyId, type]);
  }
}
