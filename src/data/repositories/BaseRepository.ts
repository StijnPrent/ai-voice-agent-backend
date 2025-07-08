// src/data/repositories/BaseRepository.ts
import pool from "../../config/database";
import { Pool } from "mysql2/promise";

export abstract class BaseRepository {
    protected pool: Pool;

    constructor() {
        this.pool = pool;
    }

    protected async execute<T>(sql: string, params: any[]): Promise<T> {
        try {
            const [results] = await this.pool.query(sql, params);
            return results as T;
        } catch (error) {
            console.error("Database query error:", error);
            // Re-throw a generic error to avoid leaking implementation details
            throw new Error("A database error occurred.");
        }
    }
}
