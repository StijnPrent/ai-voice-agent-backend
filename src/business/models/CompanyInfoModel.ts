export class CompanyInfoModel {

    constructor(
        private _id: number,
        private _value: string,
        private _createdAt: Date
    ) {
    }

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            value: this.value,
            infoValue: this.value,
            createdAt: this.createdAt.toISOString(),
        };
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