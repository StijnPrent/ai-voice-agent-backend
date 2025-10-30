import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import {
    IVapiSessionRepository,
    UpsertVapiSessionInput,
    VapiSessionRecord,
} from "../interfaces/IVapiSessionRepository";

export class VapiSessionRepository extends BaseRepository implements IVapiSessionRepository {
    private initialized = false;

    public async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        const sql = `
            CREATE TABLE IF NOT EXISTS vapi_active_sessions (
                call_id VARCHAR(191) PRIMARY KEY,
                call_sid VARCHAR(191) NULL,
                worker_id VARCHAR(191) NOT NULL,
                worker_address VARCHAR(512) NULL,
                registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NULL,
                INDEX idx_worker_id (worker_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `;

        await this.pool.query(sql);
        this.initialized = true;
    }

    public async upsertSession(input: UpsertVapiSessionInput): Promise<void> {
        await this.ensureInitialized();

        const sql = `
            REPLACE INTO vapi_active_sessions
                (call_id, call_sid, worker_id, worker_address, registered_at, expires_at)
            VALUES (?, ?, ?, ?, NOW(), ?)
        `;

        await this.pool.query(sql, [
            input.callId,
            input.callSid,
            input.workerId,
            input.workerAddress,
            input.expiresAt,
        ]);
    }

    public async deleteSession(callId: string): Promise<void> {
        await this.ensureInitialized();

        const sql = `DELETE FROM vapi_active_sessions WHERE call_id = ?`;
        await this.pool.query(sql, [callId]);
    }

    public async findSession(callId: string): Promise<VapiSessionRecord | null> {
        await this.ensureInitialized();

        const sql = `
            SELECT
                call_id AS callId,
                call_sid AS callSid,
                worker_id AS workerId,
                worker_address AS workerAddress,
                registered_at AS registeredAt,
                expires_at AS expiresAt
            FROM vapi_active_sessions
            WHERE call_id = ?
            LIMIT 1
        `;

        const [rows] = await this.pool.query<RowDataPacket[]>(sql, [callId]);
        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }

        const row = rows[0];
        return {
            callId: String(row.callId),
            callSid: row.callSid ? String(row.callSid) : null,
            workerId: String(row.workerId),
            workerAddress: row.workerAddress ? String(row.workerAddress) : null,
            registeredAt: row.registeredAt instanceof Date ? row.registeredAt : null,
            expiresAt: row.expiresAt instanceof Date ? row.expiresAt : null,
        };
    }

    public async deleteExpiredSessions(): Promise<void> {
        await this.ensureInitialized();

        const sql = `
            DELETE FROM vapi_active_sessions
            WHERE expires_at IS NOT NULL AND expires_at < NOW()
        `;

        await this.pool.query(sql);
    }

    public async clearWorkerSessions(workerId: string): Promise<void> {
        await this.ensureInitialized();

        const sql = `DELETE FROM vapi_active_sessions WHERE worker_id = ?`;
        await this.pool.query(sql, [workerId]);
    }
}
