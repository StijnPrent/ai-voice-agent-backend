export class CompanyDetailsModel {
    constructor(
        private _id: number,
        private _companyId: bigint,
        private _name: string,
        private _industry: string,
        private _size: string,
        private _foundedYear: number,
        private _description: string
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this._id,
            companyId: this._companyId.toString(),
            name: this._name,
            industry: this._industry,
            size: this._size,
            foundedYear: this._foundedYear,
            description: this._description,
        };
    }

    get id(): number { return this._id; }
    get companyId(): bigint { return this._companyId; }
    get name(): string { return this._name; }
    get industry(): string { return this._industry; }
    get size(): string { return this._size; }
    get foundedYear(): number { return this._foundedYear; }
    get description(): string { return this._description; }
}