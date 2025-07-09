export class CompanyModel {
    private _id: bigint;
    private _email: string;
    private _name: string;
    private _website: string;
    private _twilioNumber: string;
    private _createdAt: Date;
    private _updatedAt: Date;

    constructor(
        id: bigint,
        email: string,
        name: string,
        website: string,
        twilioNumber: string,
        createdAt: Date,
        updatedAt: Date
    ) {
        this._id = id;
        this._email = email;
        this._name = name;
        this._website = website;
        this._twilioNumber = twilioNumber;
        this._createdAt = createdAt;
        this._updatedAt = updatedAt;
    }

    public toJSON(): Record<string, any> {
        return {
            id: this._id.toString(),
            email: this._email,
            name: this._name,
            website: this._website,
            twilioNumber: this._twilioNumber,
            createdAt: this._createdAt.toISOString(),
            updatedAt: this._updatedAt.toISOString(),
        };
    }

    public get id(): bigint {
        return this._id;
    }
    
    public get email(): string {
        return this._email;
    }

    public get name(): string {
        return this._name;
    }

    public get website(): string {
        return this._website;
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
}