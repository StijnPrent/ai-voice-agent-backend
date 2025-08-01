// src/data/repositories/CompanyRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { CompanyModel } from "../../business/models/CompanyModel";
import { CompanyInfoModel } from "../../business/models/CompanyInfoModel";
import { ICompanyRepository } from "../interfaces/ICompanyRepository";
import { BaseRepository } from "./BaseRepository";

export class CompanyRepository extends BaseRepository implements ICompanyRepository {
    public async createCompany(company: CompanyModel): Promise<void> {
        const sql = `
            INSERT INTO company (id, name, email, website, twilio_number, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        `;
        await this.execute(sql, [company.id, company.name, company.email, company.website, company.twilioNumber]);
    }

    public async findByTwilioNumber(twilioNumber: string): Promise<CompanyModel | null> {
        const sql = `
            SELECT id, name, email, website, twilio_number, created_at, updated_at
            FROM company
            WHERE twilio_number = ?
            LIMIT 1
        `;
        const results = await this.execute<RowDataPacket[]>(sql, [twilioNumber]);
        if (results.length === 0) {
            return null;
        }
        const row = results[0];
        return new CompanyModel(
            row.id,
            row.name,
            row.email,
            row.website,
            row.twilio_number,
            row.created_at,
            row.updated_at
        );
    }

    public async findByEmail(email: string): Promise<CompanyModel | null> {
        const sql = `
            SELECT id, name, email, website, twilio_number, created_at, updated_at
            FROM company
            WHERE email = ?
                LIMIT 1
        `;
        const results = await this.execute<RowDataPacket[]>(sql, [email]);
        if (results.length === 0) {
            return null;
        }
        const row = results[0];

        // Swap row.email and row.name to match your CompanyModel signature
        return new CompanyModel(
            BigInt(row.id),         // id as bigint
            row.email,         // email
            row.name,          // name
            row.website,
            row.twilio_number,
            row.created_at,
            row.updated_at
        );
    }


    public async setCalendarConnected(companyId: bigint, connected: boolean): Promise<void> {
        const sql = `
            UPDATE company
            SET is_calendar_connected = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute(sql, [connected, companyId]);
    }

    public async addInfo(companyId: bigint, value: string): Promise<void> {
        const sql = `
            INSERT INTO company_info (company_id, info_value, created_at)
            VALUES (?, ?, NOW())
        `;
        await this.execute(sql, [companyId, value]);
    }

    public async removeInfo(infoId: number): Promise<void> {
        const sql = "DELETE FROM company_info WHERE id = ?";
        await this.execute(sql, [infoId]);
    }

    public async fetchInfo(companyId: bigint): Promise<CompanyInfoModel[]> {
        const sql = `
            SELECT id, info_value, created_at
            FROM company_info
            WHERE company_id = ?
            ORDER BY created_at
        `;
        const results = await this.execute<RowDataPacket[]>(sql, [companyId]);
        return results.map(row => new CompanyInfoModel(
            row.id,
            row.info_value,
            row.created_at
        ));
    }
}