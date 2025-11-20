import { AppointmentCategoryModel } from "./AppointmentCategoryModel";

export class AppointmentTypeModel {
    constructor(
        private _id: number,
        private _companyId: bigint,
        private _name: string,
        private _duration: number,
        private _price: number | null,
        private _description: string | null,
        private _category: AppointmentCategoryModel | null = null,
        private _createdAt?: Date,
        private _updatedAt?: Date,
        private _categoryIdOverride: number | null = null
    ) {}

    public toJSON(): Record<string, any> {
        return {
            id: this.id,
            companyId: this.companyId.toString(),
            name: this.name,
            duration: this.duration,
            price: this.price,
            description: this.description,
            category: this.category ? this.category.toJSON() : null,
            categoryId: this.categoryId,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    get id(): number { return this._id; }
    get companyId(): bigint { return this._companyId; }
    get name(): string { return this._name; }
    get duration(): number { return this._duration; }
    get price(): number | null { return this._price; }
    get description(): string | null { return this._description; }
    get category(): AppointmentCategoryModel | null { return this._category; }
    get categoryId(): number | null { return this._category?.id ?? this._categoryIdOverride ?? null; }
    get createdAt(): Date | undefined { return this._createdAt; }
    get updatedAt(): Date | undefined { return this._updatedAt; }
}
