export class CompanyInfoModel {
    private _id: number;
    private _value: string;
    private _createdAt: Date;

    constructor(id: number, value: string, createdAt: Date) {
        this._id = id;
        this._value = value;
        this._createdAt = createdAt;
    }

    get id(): number {
        return this._id;
    }

    get value(): string {
        return this._value;
    }

    get createdAt(): Date {
        return this._createdAt;
    }
}