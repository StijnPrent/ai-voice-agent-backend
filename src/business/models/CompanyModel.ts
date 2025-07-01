export class CompanyModel {
    private _id: bigint;
    private _name: string;
    private _website: string;
    private _twilioNumber: string;
    private _isCalendarConnected: boolean = false;
    private _createdAt: Date;
    private _updatedAt: Date;

    constructor(
        id: bigint,
        name: string,
        website: string,
        twilioNumber: string,
        isCalendarConnected: boolean = false,
        createdAt: Date,
        updatedAt: Date
    ) {
        this._id = id;
        this._name = name;
        this._website = website;
        this._twilioNumber = twilioNumber;
        this._isCalendarConnected = isCalendarConnected;
        this._createdAt = createdAt;
        this._updatedAt = updatedAt;
    }


    get id(): bigint {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    get website(): string {
        return this._website;
    }

    get twilioNumber(): string {
        return this._twilioNumber;
    }

    get isCalendarConnected(): boolean {
        return this._isCalendarConnected;
    }

    get createdAt(): Date {
        return this._createdAt;
    }

    get updatedAt(): Date {
        return this._updatedAt;
    }
}