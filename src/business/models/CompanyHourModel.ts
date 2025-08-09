export class CompanyHourModel {
    constructor(
        private _id: number,
        private _companyId: bigint,
        private _dayOfWeek: number,
        private _isOpen: boolean,
        private _openTime: string | null,
        private _closeTime: string | null
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this._id,
            companyId: this._companyId.toString(),
            dayOfWeek: this._dayOfWeek,
            isOpen: this._isOpen,
            openTime: this._openTime,
            closeTime: this._closeTime,
        };
    }

    get id(): number { return this._id; }
    get companyId(): bigint { return this._companyId; }
    get dayOfWeek(): number { return this._dayOfWeek; }
    get isOpen(): boolean { return this._isOpen; }
    get openTime(): string | null { return this._openTime; }
    get closeTime(): string | null { return this._closeTime; }
}