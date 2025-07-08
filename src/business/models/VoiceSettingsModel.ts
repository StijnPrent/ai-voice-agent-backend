export class VoiceSettingModel {
    private _id: number;
    private _companyId: number;
    private _welcomePhrase: string;
    private _talkingSpeed: number;
    private _createdAt: Date = new Date();
    private _updatedAt: Date = new Date();
    
    constructor(
        id: number,
        companyId: number,
        welcomePhrase: string,
        talkingSpeed: number,
        createdAt: Date = new Date(),
        updatedAt: Date = new Date(),
    ) {
        this._id = id;
        this._companyId = companyId;
        this._welcomePhrase = welcomePhrase;
        this._talkingSpeed = talkingSpeed;
        this._createdAt = createdAt;
        this._updatedAt = updatedAt;
    }

    public toJSON(): Record<string, any> {
        return {
            id: this._id,
            companyId: this._companyId,
            welcomePhrase: this._welcomePhrase,
            talkingSpeed: this._talkingSpeed,
            createdAt: this._createdAt.toISOString(),
            updatedAt: this._updatedAt.toISOString(),
        };
    }

    public get id(): number {
        return this._id;
    }

    public get companyId(): number {
        return this._companyId;
    }

    public get welcomePhrase(): string {
        return this._welcomePhrase;
    }

    public get talkingSpeed(): number {
        return this._talkingSpeed;
    }

    public get createdAt(): Date {
        return this._createdAt;
    }

    public get updatedAt(): Date {
        return this._updatedAt;
    }
}