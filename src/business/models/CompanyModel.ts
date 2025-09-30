export class CompanyModel {
    constructor(
        private _id: bigint,
        private _name: string,
        private _email: string,
        private _twilioNumber: string,
        private _createdAt: Date,
        private _updatedAt: Date,
        private _assistantId: string | null = null,
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id.toString(),
            name: this.name,
            email: this.email,
            twilioNumber: this.twilioNumber,
            createdAt: this.createdAt.toISOString(),
            updatedAt: this.updatedAt.toISOString(),
            assistantId: this.assistantId,
        };
    }

    public get id(): bigint {
        return this._id;
    }

    public get name(): string {
        return this._name;
    }

    public get email(): string {
        return this._email;
    }

    public get twilioNumber(): string {
        return this._twilioNumber;
    }

    public get createdAt(): Date {
        return this._createdAt;
    }

    public get updatedAt(): Date {
        return this._updatedAt;
    }

    public get assistantId(): string | null {
        return this._assistantId ?? null;
    }
}
