// src/data/repositories/CallLogRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { ICallLogRepository, CallLogRecord } from "../interfaces/ICallLogRepository";
import { BaseRepository } from "./BaseRepository";

export class CallLogRepository extends BaseRepository implements ICallLogRepository {
    public async upsertCallLog(
        companyId: bigint,
        callSid: string,
        fromNumber: string | null,
        vapiCallId: string | null,
        startedAt: Date,
        endedAt: Date
    ): Promise<void> {
        const sql = `
            INSERT INTO company_call_sessions
                (company_id, call_sid, from_number, vapi_call_id, started_at, ended_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                from_number = VALUES(from_number),
                vapi_call_id = VALUES(vapi_call_id),
                started_at = VALUES(started_at),
                ended_at = VALUES(ended_at),
                updated_at = NOW()
        `;

        await this.execute<ResultSetHeader>(sql, [
            companyId,
            callSid,
            fromNumber,
            vapiCallId,
            startedAt,
            endedAt,
        ]);
    }

    public async getDistinctCallerNumbers(companyId: bigint, limit: number): Promise<string[]> {
        const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 50;
        const sql = `
            SELECT from_number, MAX(started_at) AS last_started
            FROM company_call_sessions
            WHERE company_id = ?
              AND from_number IS NOT NULL
              AND from_number <> ''
            GROUP BY from_number
            ORDER BY last_started DESC
            LIMIT ?
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, normalizedLimit]);
        return rows
            .map((row) => row.from_number as string | null)
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .map((value) => value.trim());
    }

    public async getCallBySid(companyId: bigint, callSid: string): Promise<CallLogRecord | null> {
        const sql = `
            SELECT company_id, call_sid, from_number, vapi_call_id, started_at, ended_at
            FROM company_call_sessions
            WHERE company_id = ?
              AND call_sid = ?
            LIMIT 1
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, callSid]);
        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];
        return {
            companyId: BigInt(row.company_id),
            callSid: row.call_sid as string,
            fromNumber: (row.from_number as string | null) ?? null,
            vapiCallId: (row.vapi_call_id as string | null) ?? null,
            startedAt: row.started_at as Date,
            endedAt: (row.ended_at as Date | null) ?? null,
        };
    }
}
