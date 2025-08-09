export class CompanyContactModel {
    constructor(
        private _id: number,
        private _companyId: bigint,
        private _website: string,
        private _phone: string,
        private _contact_email: string,
        private _address: string
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            companyId: this.companyId.toString(),
            website: this.website,
            phone: this.phone,
            contact_email: this.contact_email,
            address: this.address,
        };
    }

    get id(): number { return this._id; }
    get companyId(): bigint { return this._companyId; }
    get website(): string { return this._website; }
    get phone(): string { return this._phone; }
    get contact_email(): string { return this._contact_email; }
    get address(): string { return this._address; }
}