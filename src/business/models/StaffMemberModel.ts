import { SpecialtyModel } from "./SpecialtyModel";
import { StaffAvailabilityModel } from "./StaffAvailabilityModel";

export class StaffMemberModel {
    constructor(
        private _id: number,
        private _companyId: bigint,
        private _name: string,
        private _specialties: SpecialtyModel[],
        private _role: string,
        private _availability: StaffAvailabilityModel[] = [],
        private _googleCalendarId: string | null = null,
        private _googleCalendarSummary: string | null = null,
        private _createdAt?: Date,
        private _updatedAt?: Date
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            companyId: this.companyId.toString(),
            name: this.name,
            specialties: this.specialties.map((s) => s.toJSON()),
            role: this.role,
            availability: this.availability.map((a) => a.toJSON()),
            googleCalendarId: this.googleCalendarId,
            googleCalendarSummary: this.googleCalendarSummary,
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

    get specialties(): SpecialtyModel[] {
        return this._specialties;
    }

    get role(): string {
        return this._role;
    }

    get availability(): StaffAvailabilityModel[] {
        return this._availability;
    }

    get googleCalendarId(): string | null {
        return this._googleCalendarId;
    }

    get googleCalendarSummary(): string | null {
        return this._googleCalendarSummary;
    }

    get createdAt(): Date | undefined {
        return this._createdAt;
    }

    get updatedAt(): Date | undefined {
        return this._updatedAt;
    }
}
