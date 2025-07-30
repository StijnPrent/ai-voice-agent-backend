export class UpdateModel {
    private _update: string
    private _createdAt: Date
    private _status: string

    constructor(update: string, createdAt: Date = new Date(), status: string) {
        this._update = update;
        this._createdAt = createdAt;
        this._status = status;
    }

    public toJSON(): Record<string, any> {
        return {
            update: this.update,
            createdAt: this.createdAt.toISOString(),
            status: this.status
        };
    }

    public get update(): string {
        return this._update;
    }

    public get createdAt(): Date {
        return this._createdAt;
    }

    public get status(): string {
        return this._status;
    }
}