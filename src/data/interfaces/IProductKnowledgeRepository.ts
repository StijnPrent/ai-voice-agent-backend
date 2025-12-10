import { ProductKnowledgeModel, ProductStatus, ProductStructuredContent } from "../../business/models/ProductKnowledgeModel";

export type ProductUpsertInput = {
    id?: number;
    name: string;
    sku?: string | null;
    summary?: string | null;
    status?: ProductStatus;
    synonyms?: string[];
    content?: ProductStructuredContent;
    source?: string | null;
};

export interface IProductKnowledgeRepository {
    listByCompany(companyId: bigint, status?: ProductStatus): Promise<ProductKnowledgeModel[]>;
    getById(companyId: bigint, productId: number): Promise<ProductKnowledgeModel | null>;
    create(companyId: bigint, payload: ProductUpsertInput): Promise<ProductKnowledgeModel>;
    update(companyId: bigint, productId: number, payload: ProductUpsertInput): Promise<ProductKnowledgeModel>;
    bulkUpsert(companyId: bigint, payloads: ProductUpsertInput[], defaultStatus?: ProductStatus): Promise<ProductKnowledgeModel[]>;
}
