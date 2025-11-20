export class AppointmentCategoryModel {
    constructor(
        private _id: number,
        private _companyId: bigint,
        private _name: string,
        private _createdAt?: Date,
        private _updatedAt?: Date
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            companyId: this.companyId.toString(),
            name: this.name,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
        };
    }

    get id(): number {
        return this._id;
    }

    get companyId(): bigint {
        return this._companyId;
    }

    get name(): string {
        return this._name;
    }

    get createdAt(): Date | undefined {
        return this._createdAt;
    }

    get updatedAt(): Date | undefined {
        return this._updatedAt;
    }
}
