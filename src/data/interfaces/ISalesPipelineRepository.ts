import { PipelinePhaseModel } from "../../business/models/PipelinePhaseModel";
import { PipelineCompanySummaryModel } from "../../business/models/PipelineCompanySummaryModel";
import { PipelineCompanyDetailModel } from "../../business/models/PipelineCompanyDetailModel";
import { PipelineCompanyNoteModel } from "../../business/models/PipelineCompanyNoteModel";
import { PipelineNotInterestedReasonModel } from "../../business/models/PipelineNotInterestedReasonModel";
import { PipelineNotInterestedReasonSummaryModel } from "../../business/models/PipelineNotInterestedReasonSummaryModel";

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
    listNotInterestedCompanies(): Promise<PipelineCompanySummaryModel[]>;
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
    markCompanyNotInterested(
        companyId: number,
        reasonId: number
    ): Promise<PipelineCompanySummaryModel>;
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
    listNotInterestedReasonSummary(): Promise<PipelineNotInterestedReasonSummaryModel[]>;

    // Notes
    listCompanyNotes(companyId: number): Promise<PipelineCompanyNoteModel[]>;
    findNoteById(noteId: number): Promise<PipelineCompanyNoteModel | null>;
    createNote(companyId: number, content: string): Promise<PipelineCompanyNoteModel>;
    updateNote(noteId: number, content: string): Promise<PipelineCompanyNoteModel>;
    deleteNote(noteId: number): Promise<void>;

    // Not interested reasons
    listReasons(): Promise<PipelineNotInterestedReasonModel[]>;
    findReasonById(reasonId: number): Promise<PipelineNotInterestedReasonModel | null>;
    createReason(reason: string): Promise<PipelineNotInterestedReasonModel>;
    updateReason(
        reasonId: number,
        reason: string
    ): Promise<PipelineNotInterestedReasonModel>;
    deleteReason(reasonId: number): Promise<void>;
}
