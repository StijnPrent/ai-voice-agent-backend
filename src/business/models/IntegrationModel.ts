export class IntegrationModel {
    private _integrationId: number
    private _name: string
    private _description: string
    private _category: string
    private _logo: string
    private _status: 'connected' | 'disconnected' | 'error'
    private _lastSync: string | null
    private _updatedAt: string | null
    private _connectUrl?: string | null
    private _connectMethod?: string | null
    
    constructor(
        integrationId: number,
        name: string,
        description: string,
        category: string,
        logo: string,
        status: 'connected' | 'disconnected' | 'error',
        lastSync: string | null = null,
        updatedAt: string | null = null,
        connectUrl?: string | null,
        connectMethod?: string | null
    ) {
        this._integrationId = integrationId;
        this._name = name;
        this._description = description;
        this._category = category;
        this._logo = logo;
        this._status = status;
        this._lastSync = lastSync;
        this._updatedAt = updatedAt;
        this._connectUrl = connectUrl ?? null;
        this._connectMethod = connectMethod ?? null;
    }

    public toJSON(): Record<string, any> {
        return {
            id: this._integrationId,
            name: this._name,
            description: this._description,
            category: this._category,
            logo: this._logo,
            status: this._status,
            lastSync: this._lastSync,
            updatedAt: this._updatedAt,
            connectUrl: this._connectUrl,
            connectMethod: this._connectMethod,
        };
    }

    public get integrationId(): number {
        return this._integrationId;
    }

    public get name(): string {
        return this._name;
    }

    public get description(): string {
        return this._description;
    }

    public get category(): string {
        return this._category;
    }

    public get logo(): string {
        return this._logo;
    }

    public get status(): "connected" | "disconnected" | "error" {
        return this._status;
    }

    public get lastSync(): string | null {
        return this._lastSync;
    }

    public get updatedAt(): string | null {
        return this._updatedAt;
    }
}
