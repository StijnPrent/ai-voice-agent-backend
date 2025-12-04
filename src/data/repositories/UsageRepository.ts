// src/data/repositories/UsageRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { IUsageRepository } from "../interfaces/IUsageRepository";
import { BaseRepository } from "./BaseRepository";

export class UsageRepository extends BaseRepository implements IUsageRepository {
    public async recordCall(
        companyId: bigint,
        callSid: string,
        startedAt: Date,
        endedAt: Date,
        durationSeconds: number
    ): Promise<void> {
        const sql = `
            INSERT INTO company_call_logs
                (company_id, call_sid, started_at, ended_at, duration_seconds, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                ended_at = VALUES(ended_at),
                duration_seconds = VALUES(duration_seconds),
                updated_at = NOW()
        `;

        await this.execute<ResultSetHeader>(sql, [
            companyId,
            callSid,
            startedAt,
            endedAt,
            durationSeconds,
        ]);
    }

    public async incrementMonthlyUsage(
        companyId: bigint,
        usageDate: Date,
        durationSeconds: number
    ): Promise<void> {
        const sql = `
            INSERT INTO company_monthly_usage
                (company_id, usage_month, total_seconds, created_at, updated_at)
            VALUES (?, DATE_FORMAT(?, '%Y-%m-01'), ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                total_seconds = total_seconds + VALUES(total_seconds),
                updated_at = NOW()
        `;

        await this.execute<ResultSetHeader>(sql, [
            companyId,
            usageDate,
            durationSeconds,
        ]);
    }

    public async getUsageForMonth(companyId: bigint, year: number, month: number): Promise<number> {
        const usageMonth = new Date(Date.UTC(year, month - 1, 1));
        const sql = `
            SELECT total_seconds
            FROM company_monthly_usage
            WHERE company_id = ?
              AND usage_month = DATE_FORMAT(?, '%Y-%m-01')
            LIMIT 1
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, usageMonth]);
        if (rows.length === 0) {
            return 0;
        }

        const totalSeconds = Number(rows[0].total_seconds ?? 0);
        return Number.isFinite(totalSeconds) ? totalSeconds : 0;
    }

    public async getUsageBetween(companyId: bigint, start: Date, end: Date): Promise<number> {
        const sql = `
            SELECT COALESCE(SUM(duration_seconds), 0) AS total_seconds
            FROM company_call_logs
            WHERE company_id = ?
              AND started_at >= ?
              AND started_at < ?
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, start, end]);
        const totalSeconds = rows.length ? Number(rows[0].total_seconds ?? 0) : 0;
        return Number.isFinite(totalSeconds) ? totalSeconds : 0;
    }
}
