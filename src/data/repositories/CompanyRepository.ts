import pool from "../../config/database";
import crypto from "crypto";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { CompanyModel } from "../../business/models/CompanyModel";
import { CompanyInfoModel} from "../../business/models/CompanyInfoModel";
import { ICompanyRepository } from "../interfaces/ICompanyRepository";

export class CompanyRepository implements ICompanyRepository {
    // Create a new company
    async createCompany(company: CompanyModel): Promise<void> {
        const sql = `
            INSERT INTO company (id, name, website, twilio_number)
            VALUES (?, ?, ?, ?)
        `;
        await pool.query<ResultSetHeader>(sql, [company.id, company.name, company.website, company.twilioNumber]);
    }

    // Fetch company by Twilio number
    async findByTwilioNumber(twilioNumber: string): Promise<CompanyModel | null> {
        console.log(twilioNumber);
        const sql = `
            SELECT id, name, website, twilio_number, calendar_connected, created_at, updated_at
            FROM company
            WHERE twilio_number = ?
                LIMIT 1
        `;
        const [rows] = await pool.query<RowDataPacket[]>(sql, [twilioNumber]);
        if (rows.length === 0) return null;
        const row = rows[0];
        return new CompanyModel(
            row.id,
            row.name,
            row.website,
            row.twilio_number,
            row.calendar_connected ? true : false,
            new Date(row.created_at),
            new Date(row.updated_at)
        )
    }

    // Toggle calendar_connected flag
    async setCalendarConnected(companyId: bigint, connected: boolean): Promise<void> {
        const sql = `
      UPDATE companies
      SET calendar_connected = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
        await pool.query(sql, [connected ? 1 : 0, companyId]);
    }

    // Add a company_info record
    async addInfo(companyId: bigint, value: string): Promise<void> {
        const sql = `
      INSERT INTO company_info (company_id, info_value)
      VALUES (?, ?)
    `;
        await pool.query<ResultSetHeader>(sql, [companyId, value]);
    }

    // Remove a company_info record by ID
    async removeInfo(infoId: number): Promise<void> {
        const sql = `DELETE FROM company_info WHERE id = ?`;
        await pool.query(sql, [infoId]);
    }

    // Fetch all info entries for a company
    async fetchInfo(companyId: bigint): Promise<CompanyInfoModel[]> {
        const sql = `
      SELECT id, info_value
      FROM company_info
      WHERE company_id = ?
      ORDER BY created_at
    `;
        const [rows] = await pool.query<RowDataPacket[]>(sql, [companyId]);
        return rows.map(r => new CompanyInfoModel(
            r.id,
            r.info_value,
            new Date(r.created_at)
        ));
    }
}