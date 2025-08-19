export class SpecialtyModel {
    constructor(
        private _id: number,
        private _name: string
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this._id,
            name: this._name
        };
    }

    get id(): number { return this._id; }
    get name(): string { return this._name; }
}
