import { PipelinePhaseModel } from "../../business/models/PipelinePhaseModel";
import { PipelineCompanySummaryModel } from "../../business/models/PipelineCompanySummaryModel";
import { PipelineCompanyDetailModel } from "../../business/models/PipelineCompanyDetailModel";
import { PipelineCompanyNoteModel } from "../../business/models/PipelineCompanyNoteModel";

export interface ISalesPipelineRepository {
    // Phases
    listPhases(): Promise<PipelinePhaseModel[]>;
    findPhaseById(phaseId: number): Promise<PipelinePhaseModel | null>;
    createPhase(phase: {
        name: string;
        order: number;
        color?: string | null;
        statusLead?: string | null;
    }): Promise<PipelinePhaseModel>;
    updatePhase(
        phaseId: number,
        updates: {
            name?: string;
            order?: number;
            color?: string | null;
            statusLead?: string | null;
        }
    ): Promise<PipelinePhaseModel>;
    deletePhase(phaseId: number): Promise<void>;

    // Companies
    listCompanies(): Promise<PipelineCompanySummaryModel[]>;
    createCompany(company: {
        name: string;
        owner?: string | null;
        phone?: string | null;
        email?: string | null;
        address?: string | null;
        city?: string | null;
        website?: string | null;
        phaseId?: number | null;
    }): Promise<PipelineCompanySummaryModel>;
    findCompanySummaryById(companyId: number): Promise<PipelineCompanySummaryModel | null>;
    findCompanyDetailById(companyId: number): Promise<PipelineCompanyDetailModel | null>;
    updateCompany(
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
    ): Promise<PipelineCompanySummaryModel>;
    deleteCompany(companyId: number): Promise<void>;

    // Notes
    listCompanyNotes(companyId: number): Promise<PipelineCompanyNoteModel[]>;
    findNoteById(noteId: number): Promise<PipelineCompanyNoteModel | null>;
    createNote(companyId: number, content: string): Promise<PipelineCompanyNoteModel>;
    updateNote(noteId: number, content: string): Promise<PipelineCompanyNoteModel>;
    deleteNote(noteId: number): Promise<void>;
}
