export class AppointmentTypeModel {
    constructor(
        private _id: number,
        private _companyId: bigint,
        private _name: string,
        private _duration: number,
        private _price: number | null,
        private _category: string | null,
        private _description: string | null,
        private _createdAt?: Date,
        private _updatedAt?: Date
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            companyId: this.companyId.toString(),
            name: this.name,
            duration: this.duration,
            price: this.price,
            category: this.category,
            description: this.description,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    get id(): number { return this._id; }
    get companyId(): bigint { return this._companyId; }
    get name(): string { return this._name; }
    get duration(): number { return this._duration; }
    get price(): number | null { return this._price; }
    get category(): string | null { return this._category; }
    get description(): string | null { return this._description; }
    get createdAt(): Date | undefined { return this._createdAt; }
    get updatedAt(): Date | undefined { return this._updatedAt; }
}
