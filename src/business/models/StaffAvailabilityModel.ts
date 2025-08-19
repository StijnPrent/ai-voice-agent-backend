export class StaffAvailabilityModel {
    constructor(
        private _id: number | null,         // mag null zijn bij create
        private _staffId: number,
        private _dayOfWeek: number,         // 0 = zondag ... 6 = zaterdag
        private _isActive: boolean,
        private _startTime: string | null,  // "HH:MM" of "HH:MM:SS" (null als inactief)
        private _endTime: string | null     // idem
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            staffId: this.staffId,
            dayOfWeek: this.dayOfWeek,
            isActive: this.isActive,
            startTime: this.startTime,
            endTime: this.endTime
        };
    }

    get id(): number | null { return this._id; }
    get staffId(): number { return this._staffId; }
    get dayOfWeek(): number { return this._dayOfWeek; }
    get isActive(): boolean { return this._isActive; }
    get startTime(): string | null { return this._startTime; }
    get endTime(): string | null { return this._endTime; }
}
