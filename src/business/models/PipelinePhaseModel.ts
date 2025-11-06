export class PipelinePhaseModel {
    constructor(
        private readonly _id: number,
        private readonly _name: string,
        private readonly _order: number,
        private readonly _color: string | null,
        private readonly _statusLead: string | null
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            name: this.name,
            order: this.order,
            color: this.color,
            statusLead: this.statusLead,
        };
    }

    get id(): number {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    get order(): number {
        return this._order;
    }

    get color(): string | null {
        return this._color;
    }

    get statusLead(): string | null {
        return this._statusLead;
    }
}
