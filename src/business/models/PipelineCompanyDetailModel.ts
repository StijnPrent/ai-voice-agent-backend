import { PipelineCompanyNoteModel } from "./PipelineCompanyNoteModel";
import { PipelineCompanySummaryModel } from "./PipelineCompanySummaryModel";

export class PipelineCompanyDetailModel {
    constructor(
        private readonly _summary: PipelineCompanySummaryModel,
        private readonly _notes: PipelineCompanyNoteModel[]
    ) {}

    public toJSON(): Record<string, any> {
        return {
            ...this._summary.toJSON(),
            notes: this._notes.map((note) => note.toJSON()),
        };
    }

    get summary(): PipelineCompanySummaryModel {
        return this._summary;
    }

    get notes(): PipelineCompanyNoteModel[] {
        return this._notes;
    }
}
