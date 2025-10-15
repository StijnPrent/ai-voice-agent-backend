import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { CallOverviewRow, IAnalyticsRepository } from "../interfaces/IAnalyticsRepository";

export class AnalyticsRepository extends BaseRepository implements IAnalyticsRepository {
    public async getCallOverview(companyId: bigint): Promise<CallOverviewRow> {
        const sql = `
            SELECT
                COUNT(*)                                             AS totalCalls,
                COALESCE(SUM(TIMESTAMPDIFF(SECOND, started_at, ended_at)), 0) AS totalDurationSeconds,
                COALESCE(AVG(TIMESTAMPDIFF(SECOND, started_at, ended_at)), 0) AS averageCallDurationSeconds
            FROM company_call_sessions
            WHERE company_id = ?
              AND ended_at IS NOT NULL
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        const row = rows[0] ?? { totalCalls: 0, totalDurationSeconds: 0, averageCallDurationSeconds: 0 };

        return {
            totalCalls: Number(row.totalCalls ?? 0),
            totalDurationSeconds: Number(row.totalDurationSeconds ?? 0),
            averageCallDurationSeconds: Number(row.averageCallDurationSeconds ?? 0),
        };
    }
}
