export type ProductFaqEntry = {
    question: string;
    answer: string;
};

export type ProductPolicyEntry = {
    title?: string | null;
    content: string;
};

export type ProductStructuredContent = {
    description?: string | null;
    summary?: string | null;
    faq?: ProductFaqEntry[];
    troubleshooting?: string[];
    policies?: ProductPolicyEntry[];
    restrictedTopics?: string[];
    metadata?: Record<string, unknown> | null;
};

export type ProductStatus = "draft" | "published";

export class ProductKnowledgeModel {
    constructor(
        public readonly id: number,
        public readonly companyId: bigint,
        public readonly name: string,
        public readonly sku: string | null,
        public readonly summary: string | null,
        public readonly status: ProductStatus,
        public readonly synonyms: string[],
        public readonly content: ProductStructuredContent,
        public readonly version: number,
        public readonly source: string | null,
        public readonly updatedAt: Date,
        public readonly createdAt: Date
    ) {}

    toJSON() {
        return {
            id: this.id,
            companyId: this.companyId.toString(),
            name: this.name,
            sku: this.sku,
            summary: this.summary,
            status: this.status,
            synonyms: this.synonyms,
            content: this.content,
            version: this.version,
            source: this.source,
            updatedAt: this.updatedAt.toISOString(),
            createdAt: this.createdAt.toISOString(),
        };
    }
}
