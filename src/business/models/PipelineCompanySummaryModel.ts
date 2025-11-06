export class PipelineCompanySummaryModel {
    constructor(
        private readonly _id: number,
        private readonly _name: string,
        private readonly _owner: string | null,
        private readonly _phone: string | null,
        private readonly _email: string | null,
        private readonly _address: string | null,
        private readonly _city: string | null,
        private readonly _website: string | null,
        private readonly _phaseId: number | null,
        private readonly _notesCount: number
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            name: this.name,
            owner: this.owner,
            phone: this.phone,
            email: this.email,
            address: this.address,
            city: this.city,
            website: this.website,
            phaseId: this.phaseId,
            notesCount: this.notesCount,
        };
    }

    get id(): number {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    get owner(): string | null {
        return this._owner;
    }

    get phone(): string | null {
        return this._phone;
    }

    get email(): string | null {
        return this._email;
    }

    get address(): string | null {
        return this._address;
    }

    get city(): string | null {
        return this._city;
    }

    get website(): string | null {
        return this._website;
    }

    get phaseId(): number | null {
        return this._phaseId;
    }

    get notesCount(): number {
        return this._notesCount;
    }
}
