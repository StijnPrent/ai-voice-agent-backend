export class PipelineNotInterestedReasonSummaryModel {
    constructor(
        private readonly _reasonId: number | null,
        private readonly _reason: string | null,
        private readonly _count: number
    ) {}

    public toJSON(): Record<string, any> {
        return {
            reasonId: this.reasonId,
            reason: this.reason,
            count: this.count,
        };
    }

    get reasonId(): number | null {
        return this._reasonId;
    }

    get reason(): string | null {
        return this._reason;
    }

    get count(): number {
        return this._count;
    }
}
