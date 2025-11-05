export class CompanyCallerModel {
    constructor(
        private readonly _id: number,
        private readonly _companyId: bigint,
        private readonly _name: string,
        private readonly _phoneNumber: string,
        private readonly _createdAt: Date | null = null,
        private readonly _updatedAt: Date | null = null
    ) {}

    get id(): number {
        return this._id;
    }

    get companyId(): bigint {
        return this._companyId;
    }

    get name(): string {
        return this._name;
    }

    get phoneNumber(): string {
        return this._phoneNumber;
    }

    get createdAt(): Date | null {
        return this._createdAt;
    }

    get updatedAt(): Date | null {
        return this._updatedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            companyId: this.companyId.toString(),
            name: this.name,
            phoneNumber: this.phoneNumber,
            createdAt: this.createdAt?.toISOString() ?? null,
            updatedAt: this.updatedAt?.toISOString() ?? null,
        };
    }
}
