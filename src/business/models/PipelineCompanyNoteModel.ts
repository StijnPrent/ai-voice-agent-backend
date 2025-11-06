export class PipelineCompanyNoteModel {
    constructor(
        private readonly _id: number,
        private readonly _companyId: number,
        private readonly _content: string,
        private readonly _createdAt: Date,
        private readonly _updatedAt: Date
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            content: this.content,
            createdAt: this.createdAt.toISOString(),
        };
    }

    get id(): number {
        return this._id;
    }

    get companyId(): number {
        return this._companyId;
    }

    get content(): string {
        return this._content;
    }

    get createdAt(): Date {
        return this._createdAt;
    }

    get updatedAt(): Date {
        return this._updatedAt;
    }
}
