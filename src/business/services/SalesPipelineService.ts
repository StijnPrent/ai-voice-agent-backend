import { inject, injectable } from "tsyringe";
import { ISalesPipelineRepository } from "../../data/interfaces/ISalesPipelineRepository";
import { PipelinePhaseModel } from "../models/PipelinePhaseModel";
import { PipelineCompanySummaryModel } from "../models/PipelineCompanySummaryModel";
import { PipelineCompanyDetailModel } from "../models/PipelineCompanyDetailModel";
import { PipelineCompanyNoteModel } from "../models/PipelineCompanyNoteModel";
import { ResourceNotFoundError } from "../errors/ResourceNotFoundError";
import { ValidationError } from "../errors/ValidationError";

@injectable()
export class SalesPipelineService {
    constructor(
        @inject("ISalesPipelineRepository")
        private readonly repository: ISalesPipelineRepository
    ) {}

    // Phases
    public async listPhases(): Promise<PipelinePhaseModel[]> {
        return this.repository.listPhases();
    }

    public async createPhase(payload: {
        name?: unknown;
        order?: unknown;
        color?: unknown;
        statusLead?: unknown;
    }): Promise<PipelinePhaseModel> {
        const name = this.ensureNonEmptyString(payload.name, "name");
        const order = this.ensureInteger(payload.order, "order");
        const color = this.ensureOptionalString(payload.color);
        const statusLead = this.ensureOptionalString(payload.statusLead);

        return this.repository.createPhase({
            name,
            order,
            color,
            statusLead,
        });
    }

    public async updatePhase(
        phaseId: number,
        payload: {
            name?: unknown;
            order?: unknown;
            color?: unknown;
            statusLead?: unknown;
        }
    ): Promise<PipelinePhaseModel> {
        const updates: {
            name?: string;
            order?: number;
            color?: string | null;
            statusLead?: string | null;
        } = {};

        if (typeof payload.name !== "undefined") {
            updates.name = this.ensureNonEmptyString(payload.name, "name");
        }
        if (typeof payload.order !== "undefined") {
            updates.order = this.ensureInteger(payload.order, "order");
        }
        if (typeof payload.color !== "undefined") {
            updates.color = this.ensureOptionalString(payload.color);
        }
        if (typeof payload.statusLead !== "undefined") {
            updates.statusLead = this.ensureOptionalString(payload.statusLead);
        }

        const phase = await this.repository.findPhaseById(phaseId);
        if (!phase) {
            throw new ResourceNotFoundError("Phase not found.");
        }

        return this.repository.updatePhase(phaseId, updates);
    }

    public async deletePhase(phaseId: number): Promise<void> {
        const phase = await this.repository.findPhaseById(phaseId);
        if (!phase) {
            throw new ResourceNotFoundError("Phase not found.");
        }
        await this.repository.deletePhase(phaseId);
    }

    // Companies
    public async listCompanies(): Promise<PipelineCompanySummaryModel[]> {
        return this.repository.listCompanies();
    }

    public async createCompany(payload: {
        name?: unknown;
        owner?: unknown;
        phone?: unknown;
        email?: unknown;
        address?: unknown;
        city?: unknown;
        website?: unknown;
        phaseId?: unknown;
    }): Promise<PipelineCompanySummaryModel> {
        const name = this.ensureNonEmptyString(payload.name, "name");
        const owner = this.ensureOptionalString(payload.owner);
        const phone = this.ensureOptionalString(payload.phone);
        const email = this.ensureOptionalString(payload.email);
        const address = this.ensureOptionalString(payload.address);
        const city = this.ensureOptionalString(payload.city);
        const website = this.ensureOptionalString(payload.website);
        const phaseId = this.ensureOptionalInteger(payload.phaseId, "phaseId");

        if (typeof phaseId === "number") {
            const phase = await this.repository.findPhaseById(phaseId);
            if (!phase) {
                throw new ValidationError("Phase not found.");
            }
        }

        return this.repository.createCompany({
            name,
            owner,
            phone,
            email,
            address,
            city,
            website,
            phaseId: typeof phaseId === "number" ? phaseId : null,
        });
    }

    public async getCompanyDetail(
        companyId: number
    ): Promise<PipelineCompanyDetailModel> {
        const detail = await this.repository.findCompanyDetailById(companyId);
        if (!detail) {
            throw new ResourceNotFoundError("Company not found.");
        }
        return detail;
    }

    public async updateCompany(
        companyId: number,
        payload: {
            name?: unknown;
            owner?: unknown;
            phone?: unknown;
            email?: unknown;
            address?: unknown;
            city?: unknown;
            website?: unknown;
            phaseId?: unknown;
        }
    ): Promise<PipelineCompanySummaryModel> {
        const updates: {
            name?: string;
            owner?: string | null;
            phone?: string | null;
            email?: string | null;
            address?: string | null;
            city?: string | null;
            website?: string | null;
            phaseId?: number | null;
        } = {};

        if (typeof payload.name !== "undefined") {
            updates.name = this.ensureNonEmptyString(payload.name, "name");
        }
        if (typeof payload.owner !== "undefined") {
            updates.owner = this.ensureOptionalString(payload.owner);
        }
        if (typeof payload.phone !== "undefined") {
            updates.phone = this.ensureOptionalString(payload.phone);
        }
        if (typeof payload.email !== "undefined") {
            updates.email = this.ensureOptionalString(payload.email);
        }
        if (typeof payload.address !== "undefined") {
            updates.address = this.ensureOptionalString(payload.address);
        }
        if (typeof payload.city !== "undefined") {
            updates.city = this.ensureOptionalString(payload.city);
        }
        if (typeof payload.website !== "undefined") {
            updates.website = this.ensureOptionalString(payload.website);
        }

        if (typeof payload.phaseId !== "undefined") {
            const phaseId = this.ensureOptionalInteger(payload.phaseId, "phaseId");
            if (typeof phaseId === "number") {
                const phase = await this.repository.findPhaseById(phaseId);
                if (!phase) {
                    throw new ValidationError("Phase not found.");
                }
            }
            updates.phaseId = typeof phaseId === "number" ? phaseId : null;
        }

        const existing = await this.repository.findCompanySummaryById(companyId);
        if (!existing) {
            throw new ResourceNotFoundError("Company not found.");
        }

        if (Object.keys(updates).length === 0) {
            return existing;
        }

        return this.repository.updateCompany(companyId, updates);
    }

    public async deleteCompany(companyId: number): Promise<void> {
        const company = await this.repository.findCompanySummaryById(companyId);
        if (!company) {
            throw new ResourceNotFoundError("Company not found.");
        }
        await this.repository.deleteCompany(companyId);
    }

    public async addNote(
        companyId: number,
        payload: { content?: unknown }
    ): Promise<PipelineCompanyNoteModel> {
        const content = this.ensureNonEmptyString(payload.content, "content");

        const company = await this.repository.findCompanySummaryById(companyId);
        if (!company) {
            throw new ResourceNotFoundError("Company not found.");
        }

        return this.repository.createNote(companyId, content);
    }

    public async updateNote(
        companyId: number,
        noteId: number,
        payload: { content?: unknown }
    ): Promise<PipelineCompanyNoteModel> {
        const content = this.ensureNonEmptyString(payload.content, "content");
        const note = await this.repository.findNoteById(noteId);
        if (!note || note.companyId !== companyId) {
            throw new ResourceNotFoundError("Note not found.");
        }
        return this.repository.updateNote(noteId, content);
    }

    public async deleteNote(companyId: number, noteId: number): Promise<void> {
        const note = await this.repository.findNoteById(noteId);
        if (!note || note.companyId !== companyId) {
            throw new ResourceNotFoundError("Note not found.");
        }
        await this.repository.deleteNote(noteId);
    }

    // Validation helpers
    private ensureNonEmptyString(value: unknown, field: string): string {
        if (typeof value !== "string" || !value.trim()) {
            throw new ValidationError(`'${field}' is required.`);
        }
        return value.trim();
    }

    private ensureOptionalString(value: unknown): string | null {
        if (typeof value === "undefined" || value === null) {
            return null;
        }
        if (typeof value !== "string") {
            throw new ValidationError("Expected a string value.");
        }
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }

    private ensureInteger(value: unknown, field: string): number {
        if (
            (typeof value !== "number" || !Number.isInteger(value)) &&
            !(typeof value === "string" && value.trim() !== "" && Number.isInteger(Number(value)))
        ) {
            throw new ValidationError(`'${field}' must be an integer.`);
        }
        const parsed = typeof value === "number" ? value : Number(value);
        return parsed;
    }

    private ensureOptionalInteger(
        value: unknown,
        field: string
    ): number | null {
        if (typeof value === "undefined" || value === null || value === "") {
            return null;
        }
        if (
            (typeof value !== "number" || !Number.isInteger(value)) &&
            !(typeof value === "string" && value.trim() !== "" && Number.isInteger(Number(value)))
        ) {
            throw new ValidationError(`'${field}' must be an integer.`);
        }
        return Number(value);
    }
}
