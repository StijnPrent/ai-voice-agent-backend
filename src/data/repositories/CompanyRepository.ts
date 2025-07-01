import pool from "../../config/database";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { Company, CompanyInfoItem } from "../../business/services/CompanyService";
import { ICompanyRepository } from "../interfaces/ICompanyRepository";

export class CompanyRepository implements ICompanyRepository {
    // Create a new company
    async createCompany(name: string, twilioNumber: string): Promise<Company> {
        const sql = `
            INSERT INTO companies (name, twilio_number)
            VALUES (?, ?)
        `;
        const [result] = await pool.query<ResultSetHeader>(sql, [name, twilioNumber]);
        const id = result.insertId;
        return { id, name, twilioNumber, isCalendarConnected: false };
    }

    // Fetch company by Twilio number
    async findByTwilioNumber(twilioNumber: string): Promise<Company | null> {
        const sql = `
            SELECT id, name, twilio_number, calendar_connected
            FROM companies
            WHERE twilio_number = ?
                LIMIT 1
        `;
        const [rows] = await pool.query<RowDataPacket[]>(sql, [twilioNumber]);
        if (rows.length === 0) return null;
        const row = rows[0];
        return {
            id: row.id,
            name: row.name,
            twilioNumber: row.twilio_number,
            isCalendarConnected: row.calendar_connected === 1
        };
    }

    // Toggle calendar_connected flag
    async setCalendarConnected(companyId: number, connected: boolean): Promise<void> {
        const sql = `
      UPDATE companies
      SET calendar_connected = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
        await pool.query(sql, [connected ? 1 : 0, companyId]);
    }

    // Add a company_info record
    async addInfo(companyId: number, value: string): Promise<CompanyInfoItem> {
        const sql = `
      INSERT INTO company_info (company_id, info_value)
      VALUES (?, ?)
    `;
        const [result] = await pool.query<ResultSetHeader>(sql, [companyId, value]);
        return { id: result.insertId, companyId, value };
    }

    // Remove a company_info record by ID
    async removeInfo(infoId: number): Promise<void> {
        const sql = `DELETE FROM company_info WHERE id = ?`;
        await pool.query(sql, [infoId]);
    }

    // Fetch all info entries for a company
    async fetchInfo(companyId: number): Promise<CompanyInfoItem[]> {
        const sql = `
      SELECT id, info_value
      FROM company_info
      WHERE company_id = ?
      ORDER BY created_at
    `;
        const [rows] = await pool.query<RowDataPacket[]>(sql, [companyId]);
        return rows.map(r => ({ id: r.id, companyId, value: r.info_value }));
    }
}