import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { ISalesPipelineRepository } from "../interfaces/ISalesPipelineRepository";
import { PipelinePhaseModel } from "../../business/models/PipelinePhaseModel";
import { PipelineCompanySummaryModel } from "../../business/models/PipelineCompanySummaryModel";
import { PipelineCompanyDetailModel } from "../../business/models/PipelineCompanyDetailModel";
import { PipelineCompanyNoteModel } from "../../business/models/PipelineCompanyNoteModel";
import { PipelineNotInterestedReasonModel } from "../../business/models/PipelineNotInterestedReasonModel";
import { PipelineNotInterestedReasonSummaryModel } from "../../business/models/PipelineNotInterestedReasonSummaryModel";

type PhaseRow = RowDataPacket & {
    id: number;
    name: string;
    display_order: number;
    color: string | null;
    status_lead: string | null;
};

type CompanyRow = RowDataPacket & {
    id: number;
    name: string;
    owner: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    website: string | null;
    phase_id: number | null;
    notes_count: number;
    not_interested: number;
    reason_id: number | null;
    reason: string | null;
    updated_at: Date | string | null;
};

type NoteRow = RowDataPacket & {
    id: number;
    company_id: number;
    content: string;
    created_at: Date;
    updated_at: Date;
};

type ReasonRow = RowDataPacket & {
    id: number;
    reason: string;
    created_at: Date;
};

type ReasonSummaryRow = RowDataPacket & {
    reason_id: number | null;
    reason: string | null;
    total: number;
};

export class SalesPipelineRepository
    extends BaseRepository
    implements ISalesPipelineRepository
{
    private mapPhase(row: PhaseRow): PipelinePhaseModel {
        return new PipelinePhaseModel(
            Number(row.id),
            row.name,
            Number(row.display_order),
            row.color ?? null,
            row.status_lead ?? null
        );
    }

    private mapCompanySummary(row: CompanyRow): PipelineCompanySummaryModel {
        const parsedUpdatedAt = new Date(row.updated_at ?? "");
        const safeUpdatedAt = Number.isNaN(parsedUpdatedAt.getTime())
            ? new Date()
            : parsedUpdatedAt;

        return new PipelineCompanySummaryModel(
            Number(row.id),
            row.name,
            row.owner ?? null,
            row.phone ?? null,
            row.email ?? null,
            row.address ?? null,
            row.city ?? null,
            row.website ?? null,
            row.phase_id === null || typeof row.phase_id === "undefined"
                ? null
                : Number(row.phase_id),
            Number(row.notes_count ?? 0),
            Boolean(row.not_interested),
            row.reason_id === null || typeof row.reason_id === "undefined"
                ? null
                : Number(row.reason_id),
            row.reason ?? null
        );
    }

    private mapNote(row: NoteRow): PipelineCompanyNoteModel {
        return new PipelineCompanyNoteModel(
            Number(row.id),
            Number(row.company_id),
            row.content,
            new Date(row.created_at),
            new Date(row.updated_at)
        );
    }

    private mapReason(row: ReasonRow): PipelineNotInterestedReasonModel {
        return new PipelineNotInterestedReasonModel(
            Number(row.id),
            row.reason,
            new Date(row.created_at)
        );
    }

    private mapReasonSummary(
        row: ReasonSummaryRow
    ): PipelineNotInterestedReasonSummaryModel {
        return new PipelineNotInterestedReasonSummaryModel(
            row.reason_id === null || typeof row.reason_id === "undefined"
                ? null
                : Number(row.reason_id),
            row.reason ?? null,
            Number(row.total ?? 0)
        );
    }

    public async listPhases(): Promise<PipelinePhaseModel[]> {
        const sql = `
            SELECT id, name, display_order, color, status_lead
            FROM pipeline_phase
            ORDER BY display_order ASC, id ASC
        `;
        const rows = await this.execute<PhaseRow[]>(sql, []);
        return rows.map((row) => this.mapPhase(row));
    }

    public async findPhaseById(phaseId: number): Promise<PipelinePhaseModel | null> {
        const sql = `
            SELECT id, name, display_order, color, status_lead
            FROM pipeline_phase
            WHERE id = ?
            LIMIT 1
        `;
        const rows = await this.execute<PhaseRow[]>(sql, [phaseId]);
        return rows.length ? this.mapPhase(rows[0]) : null;
    }

    public async createPhase(phase: {
        name: string;
        order: number;
        color?: string | null;
        statusLead?: string | null;
    }): Promise<PipelinePhaseModel> {
        const sql = `
            INSERT INTO pipeline_phase (name, display_order, color, status_lead, created_at, updated_at)
            VALUES (?, ?, ?, ?, NOW(), NOW())
        `;
        const result = await this.execute<ResultSetHeader>(sql, [
            phase.name,
            phase.order,
            phase.color ?? null,
            phase.statusLead ?? null,
        ]);
        const id = Number(result.insertId);
        const created = await this.findPhaseById(id);
        if (!created) {
            throw new Error("Failed to retrieve created phase.");
        }
        return created;
    }

    public async updatePhase(
        phaseId: number,
        updates: {
            name?: string;
            order?: number;
            color?: string | null;
            statusLead?: string | null;
        }
    ): Promise<PipelinePhaseModel> {
        const fields: string[] = [];
        const params: any[] = [];

        if (typeof updates.name !== "undefined") {
            fields.push("name = ?");
            params.push(updates.name);
        }
        if (typeof updates.order !== "undefined") {
            fields.push("display_order = ?");
            params.push(updates.order);
        }
        if (typeof updates.color !== "undefined") {
            fields.push("color = ?");
            params.push(updates.color ?? null);
        }
        if (typeof updates.statusLead !== "undefined") {
            fields.push("status_lead = ?");
            params.push(updates.statusLead ?? null);
        }

        if (fields.length === 0) {
            const current = await this.findPhaseById(phaseId);
            if (!current) {
                throw new Error("Phase not found.");
            }
            return current;
        }

        fields.push("updated_at = NOW()");
        const sql = `
            UPDATE pipeline_phase
            SET ${fields.join(", ")}
            WHERE id = ?
        `;
        params.push(phaseId);
        await this.execute<ResultSetHeader>(sql, params);

        const updated = await this.findPhaseById(phaseId);
        if (!updated) {
            throw new Error("Phase not found.");
        }
        return updated;
    }

    public async deletePhase(phaseId: number): Promise<void> {
        // Unlink any companies that reference the phase before deletion.
        await this.execute<ResultSetHeader>(
            `UPDATE pipeline_company SET phase_id = NULL WHERE phase_id = ?`,
            [phaseId]
        );

        await this.execute<ResultSetHeader>(
            `DELETE FROM pipeline_phase WHERE id = ?`,
            [phaseId]
        );
    }

    public async listCompanies(): Promise<PipelineCompanySummaryModel[]> {
        const sql = `
            SELECT
                c.id,
                c.name,
                c.owner,
                c.phone,
                c.email,
                c.address,
                c.city,
                c.website,
                c.phase_id,
                c.not_interested,
                c.reason_id,
                r.reason,
                c.updated_at,
                (
                    SELECT COUNT(*)
                    FROM pipeline_note n
                    WHERE n.company_id = c.id
                ) AS notes_count
            FROM pipeline_company c
            LEFT JOIN pipeline_not_interested_reason r ON r.id = c.reason_id
            WHERE c.not_interested = 0
            ORDER BY c.updated_at DESC, c.id DESC
        `;
        const rows = await this.execute<CompanyRow[]>(sql, []);
        return rows.map((row) => this.mapCompanySummary(row));
    }

    public async listCompaniesAll(): Promise<PipelineCompanySummaryModel[]> {
        const sql = `
            SELECT
                c.id,
                c.name,
                c.owner,
                c.phone,
                c.email,
                c.address,
                c.city,
                c.website,
                c.phase_id,
                c.not_interested,
                c.reason_id,
                r.reason,
                c.updated_at,
                (
                    SELECT COUNT(*)
                    FROM pipeline_note n
                    WHERE n.company_id = c.id
                ) AS notes_count
            FROM pipeline_company c
            LEFT JOIN pipeline_not_interested_reason r ON r.id = c.reason_id
            ORDER BY c.updated_at DESC, c.id DESC
        `;
        const rows = await this.execute<CompanyRow[]>(sql, []);
        return rows.map((row) => this.mapCompanySummary(row));
    }

    public async listNotInterestedCompanies(): Promise<PipelineCompanySummaryModel[]> {
        const sql = `
            SELECT
                c.id,
                c.name,
                c.owner,
                c.phone,
                c.email,
                c.address,
                c.city,
                c.website,
                c.phase_id,
                c.not_interested,
                c.reason_id,
                r.reason,
                c.updated_at,
                (
                    SELECT COUNT(*)
                    FROM pipeline_note n
                    WHERE n.company_id = c.id
                ) AS notes_count
            FROM pipeline_company c
            LEFT JOIN pipeline_not_interested_reason r ON r.id = c.reason_id
            WHERE c.not_interested = 1
            ORDER BY c.updated_at DESC, c.id DESC
        `;
        const rows = await this.execute<CompanyRow[]>(sql, []);
        return rows.map((row) => this.mapCompanySummary(row));
    }

    public async createCompany(company: {
        name: string;
        owner?: string | null;
        phone?: string | null;
        email?: string | null;
        address?: string | null;
        city?: string | null;
        website?: string | null;
        phaseId?: number | null;
    }): Promise<PipelineCompanySummaryModel> {
        const sql = `
            INSERT INTO pipeline_company
                (name, owner, phone, email, address, city, website, phase_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        const result = await this.execute<ResultSetHeader>(sql, [
            company.name,
            company.owner ?? null,
            company.phone ?? null,
            company.email ?? null,
            company.address ?? null,
            company.city ?? null,
            company.website ?? null,
            typeof company.phaseId === "number" ? company.phaseId : null,
        ]);

        const created = await this.findCompanySummaryById(Number(result.insertId));
        if (!created) {
            throw new Error("Failed to retrieve created company.");
        }
        return created;
    }

    public async findCompanySummaryById(
        companyId: number
    ): Promise<PipelineCompanySummaryModel | null> {
        const sql = `
            SELECT
                c.id,
                c.name,
                c.owner,
                c.phone,
                c.email,
                c.address,
                c.city,
                c.website,
                c.phase_id,
                c.not_interested,
                c.reason_id,
                r.reason,
                c.updated_at,
                (
                    SELECT COUNT(*) FROM pipeline_note n WHERE n.company_id = c.id
                ) AS notes_count
            FROM pipeline_company c
            LEFT JOIN pipeline_not_interested_reason r ON r.id = c.reason_id
            WHERE c.id = ?
            LIMIT 1
        `;
        const rows = await this.execute<CompanyRow[]>(sql, [companyId]);
        return rows.length ? this.mapCompanySummary(rows[0]) : null;
    }

    public async findCompanyDetailById(
        companyId: number
    ): Promise<PipelineCompanyDetailModel | null> {
        const summary = await this.findCompanySummaryById(companyId);
        if (!summary) {
            return null;
        }

        const notes = await this.listCompanyNotes(companyId);
        return new PipelineCompanyDetailModel(summary, notes);
    }

    public async markCompanyNotInterested(
        companyId: number,
        reasonId: number
    ): Promise<PipelineCompanySummaryModel> {
        const sql = `
            UPDATE pipeline_company
            SET
                not_interested = 1,
                reason_id = ?,
                phase_id = NULL,
                updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [reasonId, companyId]);

        const updated = await this.findCompanySummaryById(companyId);
        if (!updated) {
            throw new Error("Company not found.");
        }
        return updated;
    }

    public async updateCompany(
        companyId: number,
        updates: {
            name?: string;
            owner?: string | null;
            phone?: string | null;
            email?: string | null;
            address?: string | null;
            city?: string | null;
            website?: string | null;
            phaseId?: number | null;
        }
    ): Promise<PipelineCompanySummaryModel> {
        const fields: string[] = [];
        const params: any[] = [];

        if (typeof updates.name !== "undefined") {
            fields.push("name = ?");
            params.push(updates.name);
        }
        if (typeof updates.owner !== "undefined") {
            fields.push("owner = ?");
            params.push(updates.owner ?? null);
        }
        if (typeof updates.phone !== "undefined") {
            fields.push("phone = ?");
            params.push(updates.phone ?? null);
        }
        if (typeof updates.email !== "undefined") {
            fields.push("email = ?");
            params.push(updates.email ?? null);
        }
        if (typeof updates.address !== "undefined") {
            fields.push("address = ?");
            params.push(updates.address ?? null);
        }
        if (typeof updates.city !== "undefined") {
            fields.push("city = ?");
            params.push(updates.city ?? null);
        }
        if (typeof updates.website !== "undefined") {
            fields.push("website = ?");
            params.push(updates.website ?? null);
        }
        if (typeof updates.phaseId !== "undefined") {
            fields.push("phase_id = ?");
            params.push(
                typeof updates.phaseId === "number" ? updates.phaseId : null
            );
        }

        if (fields.length > 0) {
            fields.push("updated_at = NOW()");
            const sql = `
                UPDATE pipeline_company
                SET ${fields.join(", ")}
                WHERE id = ?
            `;
            params.push(companyId);
            await this.execute<ResultSetHeader>(sql, params);
        }

        const updated = await this.findCompanySummaryById(companyId);
        if (!updated) {
            throw new Error("Company not found.");
        }
        return updated;
    }

    public async deleteCompany(companyId: number): Promise<void> {
        await this.execute<ResultSetHeader>(
            `DELETE FROM pipeline_note WHERE company_id = ?`,
            [companyId]
        );
        await this.execute<ResultSetHeader>(
            `DELETE FROM pipeline_company WHERE id = ?`,
            [companyId]
        );
    }

    public async listCompanyNotes(
        companyId: number
    ): Promise<PipelineCompanyNoteModel[]> {
        const sql = `
            SELECT id, company_id, content, created_at, updated_at
            FROM pipeline_note
            WHERE company_id = ?
            ORDER BY created_at DESC, id DESC
        `;
        const rows = await this.execute<NoteRow[]>(sql, [companyId]);
        return rows.map((row) => this.mapNote(row));
    }

    public async findNoteById(noteId: number): Promise<PipelineCompanyNoteModel | null> {
        const sql = `
            SELECT id, company_id, content, created_at, updated_at
            FROM pipeline_note
            WHERE id = ?
            LIMIT 1
        `;
        const rows = await this.execute<NoteRow[]>(sql, [noteId]);
        return rows.length ? this.mapNote(rows[0]) : null;
    }

    public async createNote(
        companyId: number,
        content: string
    ): Promise<PipelineCompanyNoteModel> {
        const sql = `
            INSERT INTO pipeline_note (company_id, content, created_at, updated_at)
            VALUES (?, ?, NOW(), NOW())
        `;
        const result = await this.execute<ResultSetHeader>(sql, [
            companyId,
            content,
        ]);
        const created = await this.findNoteById(Number(result.insertId));
        if (!created) {
            throw new Error("Failed to retrieve created note.");
        }
        return created;
    }

    public async updateNote(
        noteId: number,
        content: string
    ): Promise<PipelineCompanyNoteModel> {
        const sql = `
            UPDATE pipeline_note
            SET content = ?, updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [content, noteId]);
        const updated = await this.findNoteById(noteId);
        if (!updated) {
            throw new Error("Note not found.");
        }
        return updated;
    }

    public async deleteNote(noteId: number): Promise<void> {
        await this.execute<ResultSetHeader>(
            `DELETE FROM pipeline_note WHERE id = ?`,
            [noteId]
        );
    }

    public async listNotInterestedReasonSummary(): Promise<
        PipelineNotInterestedReasonSummaryModel[]
    > {
        const sql = `
            SELECT
                c.reason_id,
                r.reason,
                COUNT(*) AS total
            FROM pipeline_company c
            LEFT JOIN pipeline_not_interested_reason r ON r.id = c.reason_id
            WHERE c.not_interested = 1
            GROUP BY c.reason_id, r.reason
            ORDER BY total DESC, r.reason ASC
        `;
        const rows = await this.execute<ReasonSummaryRow[]>(sql, []);
        return rows.map((row) => this.mapReasonSummary(row));
    }

    public async listReasons(): Promise<PipelineNotInterestedReasonModel[]> {
        const sql = `
            SELECT id, reason, created_at
            FROM pipeline_not_interested_reason
            ORDER BY created_at DESC, id DESC
        `;
        const rows = await this.execute<ReasonRow[]>(sql, []);
        return rows.map((row) => this.mapReason(row));
    }

    public async findReasonById(
        reasonId: number
    ): Promise<PipelineNotInterestedReasonModel | null> {
        const sql = `
            SELECT id, reason, created_at
            FROM pipeline_not_interested_reason
            WHERE id = ?
            LIMIT 1
        `;
        const rows = await this.execute<ReasonRow[]>(sql, [reasonId]);
        return rows.length ? this.mapReason(rows[0]) : null;
    }

    public async createReason(reason: string): Promise<PipelineNotInterestedReasonModel> {
        const sql = `
            INSERT INTO pipeline_not_interested_reason (reason, created_at)
            VALUES (?, NOW())
        `;
        const result = await this.execute<ResultSetHeader>(sql, [reason]);
        const created = await this.findReasonById(Number(result.insertId));
        if (!created) {
            throw new Error("Failed to retrieve created reason.");
        }
        return created;
    }

    public async updateReason(
        reasonId: number,
        reason: string
    ): Promise<PipelineNotInterestedReasonModel> {
        const sql = `
            UPDATE pipeline_not_interested_reason
            SET reason = ?
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [reason, reasonId]);
        const updated = await this.findReasonById(reasonId);
        if (!updated) {
            throw new Error("Reason not found.");
        }
        return updated;
    }

    public async deleteReason(reasonId: number): Promise<void> {
        await this.execute<ResultSetHeader>(
            `UPDATE pipeline_company SET reason_id = NULL WHERE reason_id = ?`,
            [reasonId]
        );
        await this.execute<ResultSetHeader>(
            `DELETE FROM pipeline_not_interested_reason WHERE id = ?`,
            [reasonId]
        );
    }
}
