// src/data/repositories/CompanyRepository.ts
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { CompanyModel } from "../../business/models/CompanyModel";
import { CompanyInfoModel } from "../../business/models/CompanyInfoModel";
import { CompanyDetailsModel } from "../../business/models/CompanyDetailsModel";
import { CompanyContactModel } from "../../business/models/CompanyContactModel";
import { CompanyHourModel } from "../../business/models/CompanyHourModel";
import { CompanyCallerModel } from "../../business/models/CompanyCallerModel";
import { ICompanyRepository } from "../interfaces/ICompanyRepository";
import { BaseRepository } from "./BaseRepository";

export class CompanyRepository extends BaseRepository implements ICompanyRepository {

    private async touchCompany(companyId: bigint): Promise<void> {
        const sql = `UPDATE company SET updated_at = NOW() WHERE id = ?`;
        await this.execute<ResultSetHeader>(sql, [companyId]);
    }

    // ---------- Companies ----------
    public async createCompany(company: CompanyModel): Promise<void> {
        const sql = `
            INSERT INTO company
                (id, email, twilio_number, assistant_enabled, assistant_outside_hours_only, assistant_transfers_enabled, email_verified_at, created_at, updated_at, use_type)
            VALUES (?, ?, ?, ?, ?, ?, NULL, NOW(), NOW(), ?)
        `;
        await this.execute<ResultSetHeader>(sql, [
            company.id,
            company.email,
            company.twilioNumber,
            company.assistantEnabled ? 1 : 0,
            company.assistantOutsideHoursOnly ? 1 : 0,
            company.assistantTransfersEnabled ? 1 : 0,
            company.useType ?? null,
        ]);
    }

    public async findByTwilioNumber(twilioNumber: string): Promise<CompanyModel | null> {
        const sql = `
            SELECT c.id, c.email, c.twilio_number, c.created_at, c.updated_at, cd.name, c.vapi_assistant_id, c.assistant_enabled, c.assistant_outside_hours_only, c.assistant_transfers_enabled, c.email_verified_at, c.use_type
            FROM company c
            LEFT JOIN company_details cd ON c.id = cd.company_id
            WHERE c.twilio_number = ?
                LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [twilioNumber]);
        if (rows.length === 0) return null;
        const r = rows[0];
        const assistantId = r.vapi_assistant_id ? String(r.vapi_assistant_id) : null;
        const assistantEnabled =
            typeof r.assistant_enabled === "undefined" || r.assistant_enabled === null
                ? true
                : r.assistant_enabled === 1 ||
                  r.assistant_enabled === "1" ||
                  r.assistant_enabled === true;
        const assistantOutsideHoursOnly =
            typeof r.assistant_outside_hours_only === "undefined" || r.assistant_outside_hours_only === null
                ? false
                : r.assistant_outside_hours_only === 1 ||
                  r.assistant_outside_hours_only === "1" ||
                  r.assistant_outside_hours_only === true;
        const assistantTransfersEnabled =
            typeof r.assistant_transfers_enabled === "undefined" || r.assistant_transfers_enabled === null
                ? true
                : r.assistant_transfers_enabled === 1 ||
                  r.assistant_transfers_enabled === "1" ||
                  r.assistant_transfers_enabled === true;

        const emailVerifiedAt = r.email_verified_at ? new Date(r.email_verified_at) : null;
        const useType = r.use_type ? String(r.use_type) : null;

        return new CompanyModel(
            BigInt(r.id),
            r.name,
            r.email,
            r.twilio_number,
            r.created_at,
            r.updated_at,
            assistantId,
            assistantEnabled,
            assistantOutsideHoursOnly,
            assistantTransfersEnabled,
            emailVerifiedAt,
            useType
        );
    }

    public async findByEmail(email: string): Promise<CompanyModel | null> {
        const sql = `
            SELECT c.id, c.email, c.twilio_number, c.created_at, c.updated_at, cd.name, c.vapi_assistant_id, c.assistant_enabled, c.assistant_outside_hours_only, c.assistant_transfers_enabled, c.email_verified_at, c.use_type
            FROM company c
            LEFT JOIN company_details cd ON c.id = cd.company_id
            WHERE c.email = ?
                LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [email]);
        if (rows.length === 0) return null;
        const r = rows[0];
        const assistantId = r.vapi_assistant_id ? String(r.vapi_assistant_id) : null;
        const assistantEnabled =
            typeof r.assistant_enabled === "undefined" || r.assistant_enabled === null
                ? true
                : r.assistant_enabled === 1 ||
                  r.assistant_enabled === "1" ||
                  r.assistant_enabled === true;
        const assistantOutsideHoursOnly =
            typeof r.assistant_outside_hours_only === "undefined" || r.assistant_outside_hours_only === null
                ? false
                : r.assistant_outside_hours_only === 1 ||
                  r.assistant_outside_hours_only === "1" ||
                  r.assistant_outside_hours_only === true;
        const assistantTransfersEnabled =
            typeof r.assistant_transfers_enabled === "undefined" || r.assistant_transfers_enabled === null
                ? true
                : r.assistant_transfers_enabled === 1 ||
                  r.assistant_transfers_enabled === "1" ||
                  r.assistant_transfers_enabled === true;

        const emailVerifiedAt = r.email_verified_at ? new Date(r.email_verified_at) : null;
        const useType = r.use_type ? String(r.use_type) : null;
        return new CompanyModel(
            BigInt(r.id),
            r.name,
            r.email,
            r.twilio_number,
            r.created_at,
            r.updated_at,
            assistantId,
            assistantEnabled,
            assistantOutsideHoursOnly,
            assistantTransfersEnabled,
            emailVerifiedAt,
            useType
        );
    }

    public async findById(companyId: bigint): Promise<CompanyModel | null> {
        const sql = `
            SELECT c.id, c.email, c.twilio_number, c.created_at, c.updated_at, cd.name, c.vapi_assistant_id, c.assistant_enabled, c.assistant_outside_hours_only, c.assistant_transfers_enabled, c.email_verified_at, c.use_type
            FROM company c
            LEFT JOIN company_details cd ON c.id = cd.company_id
            WHERE c.id = ?
                LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (rows.length === 0) return null;
        const r = rows[0];
        const assistantId = r.vapi_assistant_id ? String(r.vapi_assistant_id) : null;
        const assistantEnabled =
            typeof r.assistant_enabled === "undefined" || r.assistant_enabled === null
                ? true
                : r.assistant_enabled === 1 ||
                  r.assistant_enabled === "1" ||
                  r.assistant_enabled === true;
        const assistantOutsideHoursOnly =
            typeof r.assistant_outside_hours_only === "undefined" || r.assistant_outside_hours_only === null
                ? false
                : r.assistant_outside_hours_only === 1 ||
                  r.assistant_outside_hours_only === "1" ||
                  r.assistant_outside_hours_only === true;
        const assistantTransfersEnabled =
            typeof r.assistant_transfers_enabled === "undefined" || r.assistant_transfers_enabled === null
                ? true
                : r.assistant_transfers_enabled === 1 ||
                  r.assistant_transfers_enabled === "1" ||
                  r.assistant_transfers_enabled === true;

        const emailVerifiedAt = r.email_verified_at ? new Date(r.email_verified_at) : null;
        const useType = r.use_type ? String(r.use_type) : null;
        return new CompanyModel(
            BigInt(r.id),
            r.name,
            r.email,
            r.twilio_number,
            r.created_at,
            r.updated_at,
            assistantId,
            assistantEnabled,
            assistantOutsideHoursOnly,
            assistantTransfersEnabled,
            emailVerifiedAt,
            useType
        );
    }

    public async saveAssistantId(companyId: bigint, assistantId: string): Promise<void> {
        const sql = `
            UPDATE company
            SET vapi_assistant_id = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [assistantId, companyId]);
    }

    public async setCalendarConnected(companyId: bigint, connected: boolean): Promise<void> {
        const sql = `
            UPDATE company
            SET is_calendar_connected = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            connected ? 1 : 0,
            companyId
        ]);
    }

    public async setAssistantEnabled(companyId: bigint, enabled: boolean): Promise<void> {
        const sql = `
            UPDATE company
            SET assistant_enabled = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            enabled ? 1 : 0,
            companyId
        ]);
    }

    public async setAssistantOutsideHoursOnly(companyId: bigint, enabled: boolean): Promise<void> {
        const sql = `
            UPDATE company
            SET assistant_outside_hours_only = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            enabled ? 1 : 0,
            companyId
        ]);
    }

    public async setAssistantTransfersEnabled(companyId: bigint, enabled: boolean): Promise<void> {
        const sql = `
            UPDATE company
            SET assistant_transfers_enabled = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            enabled ? 1 : 0,
            companyId
        ]);
    }

    public async markEmailVerified(companyId: bigint): Promise<void> {
        const sql = `
            UPDATE company
            SET email_verified_at = NOW(), updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [companyId]);
    }

    // ---------- Company Info ----------
    public async addInfo(companyId: bigint, value: string): Promise<CompanyInfoModel> {
        const sql = `
            INSERT INTO company_info
                (company_id, info_value, created_at)
            VALUES (?, ?, NOW())
        `;
        const result = await this.execute<ResultSetHeader>(sql, [companyId, value]);
        const insertedId = result.insertId;
        const model = await this.findInfoById(insertedId);
        if (!model) {
            return new CompanyInfoModel(insertedId, value, new Date());
        }
        return model;
    }

    public async updateInfo(info: CompanyInfoModel): Promise<CompanyInfoModel> {
        const sql = `
            UPDATE company_info
            SET info_value = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [info.value, info.id]);
        const updated = await this.findInfoById(info.id);
        return (
            updated ?? new CompanyInfoModel(info.id, info.value, new Date())
        );
    }

    public async removeInfo(infoId: number): Promise<void> {
        const sql = `DELETE FROM company_info WHERE id = ?`;
        await this.execute<ResultSetHeader>(sql, [infoId]);
    }

    public async fetchInfo(companyId: bigint): Promise<CompanyInfoModel[]> {
        const sql = `
            SELECT id, info_value, created_at
            FROM company_info
            WHERE company_id = ?
            ORDER BY created_at
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        return rows.map(r => new CompanyInfoModel(r.id, r.info_value, r.created_at));
    }

    public async getCompanyIdForInfo(infoId: number): Promise<bigint | null> {
        const sql = `SELECT company_id FROM company_info WHERE id = ? LIMIT 1`;
        const rows = await this.execute<RowDataPacket[]>(sql, [infoId]);
        if (rows.length === 0) return null;
        return BigInt(rows[0].company_id);
    }

    public async findInfoById(infoId: number): Promise<CompanyInfoModel | null> {
        const sql = `
            SELECT id, info_value, created_at
            FROM company_info
            WHERE id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [infoId]);
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0];
        return new CompanyInfoModel(row.id, row.info_value, row.created_at);
    }

    // ---------- Company Details ----------
    public async addCompanyDetails(details: CompanyDetailsModel): Promise<CompanyDetailsModel> {
        const sql = `
            INSERT INTO company_details
            (company_id, name, industry, size, founded_year, description)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const result = await this.execute<ResultSetHeader>(sql, [
            details.companyId,
            details.name,
            details.industry,
            details.size,
            details.foundedYear,
            details.description
        ]);
        const insertedId = result.insertId || 0;
        return new CompanyDetailsModel(
            insertedId,
            details.companyId,
            details.name,
            details.industry,
            details.size,
            details.foundedYear,
            details.description
        );
    }

    public async fetchCompanyDetails(companyId: bigint): Promise<CompanyDetailsModel | null> {
        const sql = `
            SELECT *
            FROM company_details
            WHERE company_id = ?
                LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return new CompanyDetailsModel(
            r.id,
            BigInt(r.company_id),
            r.name,
            r.industry,
            r.size,
            r.founded_year,
            r.description
        );
    }

    public async updateCompanyDetails(details: CompanyDetailsModel): Promise<CompanyDetailsModel> {
        const sql = `
            UPDATE company_details
            SET name = ?, industry = ?, size = ?, founded_year = ?, description = ?
            WHERE company_id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            details.name,
            details.industry,
            details.size,
            details.foundedYear,
            details.description,
            details.companyId
        ]);
        // zorg dat updated_at altijd goed staat
        await this.touchCompany(details.companyId);
        return new CompanyDetailsModel(
            details.id,
            details.companyId,
            details.name,
            details.industry,
            details.size,
            details.foundedYear,
            details.description
        );
    }

    public async deleteCompanyDetails(detailsId: number): Promise<void> {
        const sql = `DELETE FROM company_details WHERE id = ?`;
        await this.execute<ResultSetHeader>(sql, [detailsId]);
    }

    public async getCompanyIdForDetails(detailsId: number): Promise<bigint | null> {
        const sql = `SELECT company_id FROM company_details WHERE id = ? LIMIT 1`;
        const rows = await this.execute<RowDataPacket[]>(sql, [detailsId]);
        if (rows.length === 0) return null;
        return BigInt(rows[0].company_id);
    }

    // ---------- Company Contacts ----------
    public async addCompanyContact(contact: CompanyContactModel): Promise<void> {
        const sql = `
            INSERT INTO company_contacts
                (company_id, website, phone, contact_email, address)
            VALUES (?, ?, ?, ?, ?)
        `;
        await this.execute<ResultSetHeader>(sql, [
            contact.companyId,
            contact.website,
            contact.phone,
            contact.contact_email,
            contact.address
        ]);
    }

    public async fetchCompanyContact(companyId: bigint): Promise<CompanyContactModel | null> {
        const sql = `
            SELECT *
            FROM company_contacts
            WHERE company_id = ?
                LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return new CompanyContactModel(
            r.id,
            BigInt(r.company_id),
            r.website,
            r.phone,
            r.contact_email,
            r.address
        );
    }

    public async updateCompanyContact(contact: CompanyContactModel): Promise<void> {
        const sql = `
            UPDATE company_contacts
            SET website = ?, phone = ?, contact_email = ?, address = ?
            WHERE company_id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            contact.website,
            contact.phone,
            contact.contact_email,
            contact.address,
            contact.companyId
        ]);
        await this.touchCompany(contact.companyId);
    }

    public async deleteCompanyContact(contactId: number): Promise<void> {
        const sql = `DELETE FROM company_contacts WHERE id = ?`;
        await this.execute<ResultSetHeader>(sql, [contactId]);
    }

    public async getCompanyIdForContact(contactId: number): Promise<bigint | null> {
        const sql = `SELECT company_id FROM company_contacts WHERE id = ? LIMIT 1`;
        const rows = await this.execute<RowDataPacket[]>(sql, [contactId]);
        if (rows.length === 0) return null;
        return BigInt(rows[0].company_id);
    }

    // ---------- Company Hours ----------
    public async addCompanyHour(hour: CompanyHourModel): Promise<CompanyHourModel> {
        const sql = `
            INSERT INTO company_hours
            (company_id, day_of_week, is_open, open_time, close_time)
            VALUES (?, ?, ?, ?, ?)
        `;
        const result = await this.execute<ResultSetHeader>(sql, [
            hour.companyId,
            hour.dayOfWeek,
            hour.isOpen ? 1 : 0,
            hour.openTime,
            hour.closeTime
        ]);
        const insertedId = result.insertId || 0;
        const created = await this.findCompanyHourById(insertedId);
        return (
            created ?? new CompanyHourModel(insertedId, hour.companyId, hour.dayOfWeek, hour.isOpen, hour.openTime, hour.closeTime)
        );
    }

    public async fetchCompanyHours(companyId: bigint): Promise<CompanyHourModel[]> {
        const sql = `
            SELECT *
            FROM company_hours
            WHERE company_id = ?
            ORDER BY day_of_week
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        return rows.map(r => new CompanyHourModel(
            r.id,
            BigInt(r.company_id),
            r.day_of_week,
            r.is_open === 1,
            r.open_time,
            r.close_time
        ));
    }

    public async updateCompanyHour(hour: CompanyHourModel): Promise<CompanyHourModel> {
        const sql = `
            UPDATE company_hours
            SET day_of_week = ?, is_open = ?, open_time = ?, close_time = ?
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            hour.dayOfWeek,
            hour.isOpen ? 1 : 0,
            hour.openTime,
            hour.closeTime,
            hour.id
        ]);
        await this.touchCompany(hour.companyId);
        const updated = await this.findCompanyHourById(hour.id);
        return (
            updated ?? new CompanyHourModel(hour.id, hour.companyId, hour.dayOfWeek, hour.isOpen, hour.openTime, hour.closeTime)
        );
    }

    public async deleteCompanyHour(hourId: number): Promise<void> {
        const sql = `DELETE FROM company_hours WHERE id = ?`;
        await this.execute<ResultSetHeader>(sql, [hourId]);
    }

    public async getCompanyIdForHour(hourId: number): Promise<bigint | null> {
        const sql = `SELECT company_id FROM company_hours WHERE id = ? LIMIT 1`;
        const rows = await this.execute<RowDataPacket[]>(sql, [hourId]);
        if (rows.length === 0) return null;
        return BigInt(rows[0].company_id);
    }

    public async findCompanyHourByDay(companyId: bigint, dayOfWeek: number): Promise<CompanyHourModel | null> {
        const sql = `
            SELECT *
            FROM company_hours
            WHERE company_id = ?
              AND day_of_week = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, dayOfWeek]);
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0];
        return new CompanyHourModel(
            row.id,
            BigInt(row.company_id),
            row.day_of_week,
            row.is_open === 1,
            row.open_time,
            row.close_time
        );
    }

    public async findCompanyHourById(hourId: number): Promise<CompanyHourModel | null> {
        const sql = `
            SELECT *
            FROM company_hours
            WHERE id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [hourId]);
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0];
        return new CompanyHourModel(
            row.id,
            BigInt(row.company_id),
            row.day_of_week,
            row.is_open === 1,
            row.open_time,
            row.close_time
        );
    }

    // ---------- Company Callers ----------
    public async addCompanyCaller(caller: CompanyCallerModel): Promise<CompanyCallerModel> {
        const sql = `
            INSERT INTO company_callers
                (company_id, caller_name, phone_number, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
        `;
        const result = await this.execute<ResultSetHeader>(sql, [
            caller.companyId,
            caller.name,
            caller.phoneNumber
        ]);
        const insertedId = result.insertId || 0;
        const saved = await this.findCompanyCallerById(insertedId);
        if (saved) {
            await this.touchCompany(saved.companyId);
            return saved;
        }
        await this.touchCompany(caller.companyId);
        return new CompanyCallerModel(insertedId, caller.companyId, caller.name, caller.phoneNumber);
    }

    public async updateCompanyCaller(caller: CompanyCallerModel): Promise<CompanyCallerModel> {
        const sql = `
            UPDATE company_callers
            SET caller_name = ?, phone_number = ?, updated_at = NOW()
            WHERE id = ? AND company_id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [
            caller.name,
            caller.phoneNumber,
            caller.id,
            caller.companyId
        ]);
        const saved = await this.findCompanyCallerById(caller.id);
        if (saved) {
            await this.touchCompany(saved.companyId);
            return saved;
        }
        await this.touchCompany(caller.companyId);
        return new CompanyCallerModel(caller.id, caller.companyId, caller.name, caller.phoneNumber);
    }

    public async deleteCompanyCaller(callerId: number): Promise<void> {
        const companyId = await this.getCompanyIdForCaller(callerId);
        const sql = `DELETE FROM company_callers WHERE id = ?`;
        await this.execute<ResultSetHeader>(sql, [callerId]);
        if (companyId) {
            await this.touchCompany(companyId);
        }
    }

    public async fetchCompanyCallers(companyId: bigint): Promise<CompanyCallerModel[]> {
        const sql = `
            SELECT *
            FROM company_callers
            WHERE company_id = ?
            ORDER BY caller_name ASC, phone_number ASC
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        return rows.map((row) => this.mapCallerRow(row));
    }

    public async findCompanyCallerByPhone(companyId: bigint, phoneNumber: string): Promise<CompanyCallerModel | null> {
        const sql = `
            SELECT *
            FROM company_callers
            WHERE company_id = ?
              AND phone_number = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, phoneNumber]);
        if (rows.length === 0) {
            return null;
        }
        return this.mapCallerRow(rows[0]);
    }

    public async findCompanyCallerById(callerId: number): Promise<CompanyCallerModel | null> {
        const sql = `
            SELECT *
            FROM company_callers
            WHERE id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [callerId]);
        if (rows.length === 0) {
            return null;
        }
        return this.mapCallerRow(rows[0]);
    }

    public async getCompanyIdForCaller(callerId: number): Promise<bigint | null> {
        const sql = `SELECT company_id FROM company_callers WHERE id = ? LIMIT 1`;
        const rows = await this.execute<RowDataPacket[]>(sql, [callerId]);
        if (rows.length === 0) {
            return null;
        }
        return BigInt(rows[0].company_id);
    }

    private mapCallerRow(row: RowDataPacket): CompanyCallerModel {
        return new CompanyCallerModel(
            row.id,
            BigInt(row.company_id),
            row.caller_name,
            row.phone_number,
            row.created_at ? new Date(row.created_at) : null,
            row.updated_at ? new Date(row.updated_at) : null
        );
    }
}
