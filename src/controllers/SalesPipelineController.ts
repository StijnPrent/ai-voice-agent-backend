import { Request, Response } from "express";
import { container } from "tsyringe";
import { SalesPipelineService } from "../business/services/SalesPipelineService";
import { ResourceNotFoundError } from "../business/errors/ResourceNotFoundError";
import { ValidationError } from "../business/errors/ValidationError";

export class SalesPipelineController {
    private get service(): SalesPipelineService {
        return container.resolve(SalesPipelineService);
    }

    private parseId(raw: unknown, label: string): number {
        if (typeof raw === "number" && Number.isFinite(raw)) {
            return Math.trunc(raw);
        }
        if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
            return Number(raw);
        }
        throw new ValidationError(`Invalid ${label}.`);
    }

    private handleError(res: Response, error: unknown, message: string): void {
        if (error instanceof ValidationError) {
            res.status(400).json({ message: error.message });
            return;
        }
        if (error instanceof ResourceNotFoundError) {
            res.status(404).json({ message: error.message });
            return;
        }

        console.error(error);
        res.status(500).json({ message });
    }

    // Phases
    public async listPhases(_req: Request, res: Response): Promise<void> {
        try {
            const phases = await this.service.listPhases();
            res.json(phases.map((phase) => phase.toJSON()));
        } catch (error) {
            this.handleError(res, error, "Error fetching phases.");
        }
    }

    public async createPhase(req: Request, res: Response): Promise<void> {
        try {
            const phase = await this.service.createPhase(req.body ?? {});
            res.status(201).json(phase.toJSON());
        } catch (error) {
            this.handleError(res, error, "Error creating phase.");
        }
    }

    public async updatePhase(req: Request, res: Response): Promise<void> {
        try {
            const phaseId = this.parseId(req.params.id, "phase id");
            const phase = await this.service.updatePhase(phaseId, req.body ?? {});
            res.json(phase.toJSON());
        } catch (error) {
            this.handleError(res, error, "Error updating phase.");
        }
    }

    public async deletePhase(req: Request, res: Response): Promise<void> {
        try {
            const phaseId = this.parseId(req.params.id, "phase id");
            await this.service.deletePhase(phaseId);
            res.status(204).send();
        } catch (error) {
            this.handleError(res, error, "Error deleting phase.");
        }
    }

    // Companies
    public async listCompanies(_req: Request, res: Response): Promise<void> {
        try {
            const companies = await this.service.listCompanies();
            res.json(companies.map((company) => company.toJSON()));
        } catch (error) {
            this.handleError(res, error, "Error fetching companies.");
        }
    }

    public async createCompany(req: Request, res: Response): Promise<void> {
        try {
            const company = await this.service.createCompany(req.body ?? {});
            res.status(201).json(company.toJSON());
        } catch (error) {
            this.handleError(res, error, "Error creating company.");
        }
    }

    public async getCompany(req: Request, res: Response): Promise<void> {
        try {
            const companyId = this.parseId(req.params.id, "company id");
            const detail = await this.service.getCompanyDetail(companyId);
            res.json(detail.toJSON());
        } catch (error) {
            this.handleError(res, error, "Error fetching company.");
        }
    }

    public async updateCompany(req: Request, res: Response): Promise<void> {
        try {
            const companyId = this.parseId(req.params.id, "company id");
            const company = await this.service.updateCompany(companyId, req.body ?? {});
            res.json(company.toJSON());
        } catch (error) {
            this.handleError(res, error, "Error updating company.");
        }
    }

    public async deleteCompany(req: Request, res: Response): Promise<void> {
        try {
            const companyId = this.parseId(req.params.id, "company id");
            await this.service.deleteCompany(companyId);
            res.status(204).send();
        } catch (error) {
            this.handleError(res, error, "Error deleting company.");
        }
    }

    // Notes
    public async addNote(req: Request, res: Response): Promise<void> {
        try {
            const companyId = this.parseId(req.params.id, "company id");
            const note = await this.service.addNote(companyId, req.body ?? {});
            res.status(201).json(note.toJSON());
        } catch (error) {
            this.handleError(res, error, "Error adding note.");
        }
    }

    public async updateNote(req: Request, res: Response): Promise<void> {
        try {
            const companyId = this.parseId(req.params.id, "company id");
            const noteId = this.parseId(req.params.noteId, "note id");
            const note = await this.service.updateNote(companyId, noteId, req.body ?? {});
            res.json(note.toJSON());
        } catch (error) {
            this.handleError(res, error, "Error updating note.");
        }
    }

    public async deleteNote(req: Request, res: Response): Promise<void> {
        try {
            const companyId = this.parseId(req.params.id, "company id");
            const noteId = this.parseId(req.params.noteId, "note id");
            await this.service.deleteNote(companyId, noteId);
            res.status(204).send();
        } catch (error) {
            this.handleError(res, error, "Error deleting note.");
        }
    }
}
