import {ReplyStyleEnum} from "../../utils/enums/ReplyStyleEnum";
import {ReplyStyleDescriptionEnum} from "../../utils/enums/ReplyStyleDescriptionEnum";

export class ReplyStyleModel {
    private _id: number
    private _companyId: number
    private _name: ReplyStyleEnum
    private _description: ReplyStyleDescriptionEnum
    private _createdAt: Date = new Date()
    private _updatedAt: Date = new Date()
    
    constructor(
        id: number,
        companyId: number,
        name: ReplyStyleEnum,
        description: ReplyStyleDescriptionEnum,
        createdAt: Date = new Date(),
        updatedAt: Date = new Date(),
    ) {
        this._id = id;
        this._companyId = companyId;
        this._name = name;
        this._description = description;
        this._createdAt = createdAt;
        this._updatedAt = updatedAt;
    }
    
    public toJSON(): Record<string, any> {
        return {
            id: this._id,
            companyId: this._companyId,
            name: this._name,
            description: this._description,
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

    public get name(): ReplyStyleEnum {
        return this._name;
    }

    public get description(): ReplyStyleDescriptionEnum {
        return this._description;
    }

    public get createdAt(): Date {
        return this._createdAt;
    }

    public get updatedAt(): Date {
        return this._updatedAt;
    }
}