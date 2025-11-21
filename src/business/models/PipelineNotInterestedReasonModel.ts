export class PipelineNotInterestedReasonModel {
    constructor(
        private readonly _id: number,
        private readonly _reason: string,
        private readonly _createdAt: Date
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            reason: this.reason,
            createdAt: this.createdAt.toISOString(),
        };
    }

    get id(): number {
        return this._id;
    }

    get reason(): string {
        return this._reason;
    }

    get createdAt(): Date {
        return this._createdAt;
    }
}
