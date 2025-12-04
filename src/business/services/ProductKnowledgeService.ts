import axios from "axios";
import { inject, injectable } from "tsyringe";
import { z } from "zod";
import {
    ProductKnowledgeModel,
    ProductStatus,
    ProductStructuredContent,
} from "../models/ProductKnowledgeModel";
import { IProductKnowledgeRepository, ProductUpsertInput } from "../../data/interfaces/IProductKnowledgeRepository";

const faqSchema = z.object({
    question: z.string().min(1, "FAQ question is required."),
    answer: z.string().min(1, "FAQ answer is required."),
});

const policySchema = z.object({
    title: z.string().optional().nullable(),
    content: z.string().min(1, "Policy content is required."),
});

const productSchema = z.object({
    id: z.number().optional(),
    name: z.string().min(1, "Product name is required."),
    sku: z.string().optional().nullable(),
    summary: z.string().optional().nullable(),
    status: z.enum(["draft", "published"]).optional(),
    synonyms: z.array(z.string()).optional(),
    content: z
        .object({
            description: z.string().optional().nullable(),
            summary: z.string().optional().nullable(),
            faq: z.array(faqSchema).optional(),
            troubleshooting: z.array(z.string()).optional(),
            policies: z.array(policySchema).optional(),
            restrictedTopics: z.array(z.string()).optional(),
            metadata: z.record(z.any()).optional().nullable(),
        })
        .optional(),
});

type IngestOptions = {
    rawContent: string;
    filename?: string;
    targetStatus?: ProductStatus;
    source?: string | null;
};

@injectable()
export class ProductKnowledgeService {
    constructor(
        @inject("IProductKnowledgeRepository") private readonly repository: IProductKnowledgeRepository
    ) {}

    public async listCatalog(companyId: bigint, status?: ProductStatus): Promise<ProductKnowledgeModel[]> {
        return this.repository.listByCompany(companyId, status);
    }

    public async getProduct(companyId: bigint, productId: number): Promise<ProductKnowledgeModel | null> {
        return this.repository.getById(companyId, productId);
    }

    public async upsertProduct(companyId: bigint, payload: ProductUpsertInput): Promise<ProductKnowledgeModel> {
        const normalized = this.normalizeProduct(payload);
        if (payload.id) {
            const existing = await this.repository.getById(companyId, payload.id);
            if (existing) {
                return this.repository.update(companyId, payload.id, normalized);
            }
        }
        return this.repository.create(companyId, normalized);
    }

    public async ingestFromText(
        companyId: bigint,
        options: IngestOptions
    ): Promise<ProductKnowledgeModel[]> {
        const { rawContent, filename, targetStatus, source } = options;
        const sanitized = (rawContent ?? "").trim();
        if (!sanitized) {
            throw new Error("Content is required for ingestion.");
        }

        const parsedFromJson = this.tryParseJsonArray(sanitized);
        const rawProducts = parsedFromJson ?? (await this.runStructuredExtraction(sanitized, filename));
        const validated = this.validateProducts(rawProducts, targetStatus, source);
        return this.repository.bulkUpsert(companyId, validated, targetStatus);
    }

    private normalizeProduct(payload: ProductUpsertInput): ProductUpsertInput {
        return {
            ...payload,
            name: payload.name.trim(),
            sku: payload.sku?.trim() || null,
            summary: payload.summary?.trim() || null,
            status: payload.status ?? "draft",
            synonyms: (payload.synonyms ?? []).map((s) => s.trim()).filter((s) => s.length > 0),
            content: this.normalizeContent(payload.content),
            source: payload.source ?? "manual",
        };
    }

    private normalizeContent(content?: ProductStructuredContent | null): ProductStructuredContent {
        const normalized: ProductStructuredContent = {};
        if (!content) {
            return normalized;
        }

        if (content.description) {
            normalized.description = content.description;
        }
        if (content.summary) {
            normalized.summary = content.summary;
        }
        if (Array.isArray(content.faq)) {
            normalized.faq = content.faq
                .map((entry) => ({
                    question: entry.question?.trim() ?? "",
                    answer: entry.answer?.trim() ?? "",
                }))
                .filter((entry) => entry.question && entry.answer);
        }
        if (Array.isArray(content.troubleshooting)) {
            normalized.troubleshooting = content.troubleshooting
                .map((item) => item?.toString().trim())
                .filter((item): item is string => Boolean(item));
        }
        if (Array.isArray(content.policies)) {
            normalized.policies = content.policies
                .map((policy) => ({
                    title: policy.title?.trim() || null,
                    content: policy.content?.trim() ?? "",
                }))
                .filter((policy) => policy.content.length > 0);
        }
        if (Array.isArray(content.restrictedTopics)) {
            normalized.restrictedTopics = content.restrictedTopics
                .map((item) => item?.toString().trim())
                .filter((item): item is string => Boolean(item));
        }
        if (content.metadata && typeof content.metadata === "object") {
            normalized.metadata = content.metadata;
        }

        return normalized;
    }

    private validateProducts(
        rawProducts: unknown,
        targetStatus?: ProductStatus,
        source?: string | null
    ): ProductUpsertInput[] {
        const parsed = z.array(productSchema).safeParse(rawProducts);
        if (!parsed.success) {
            throw new Error("Parsed product data is invalid: " + parsed.error.message);
        }

        return parsed.data.map((item) =>
            this.normalizeProduct({
                ...item,
                status: item.status ?? targetStatus ?? "draft",
                source: source ?? "ingestion",
            })
        );
    }

    private tryParseJsonArray(raw: string): unknown[] | null {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed;
            }
            if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).products)) {
                return (parsed as any).products;
            }
            return null;
        } catch {
            return null;
        }
    }

    private async runStructuredExtraction(rawContent: string, filename?: string): Promise<unknown[]> {
        const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY;
        if (!apiKey) {
            throw new Error(
                "OPENAI_API_KEY is not configured and the provided content is not valid JSON. Supply JSON or configure the API key."
            );
        }

        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
        const systemPrompt =
            "You convert unstructured product documentation into a strict JSON array. Output only JSON. Use this shape: [{\"name\": \"...\", \"sku\": \"...\", \"summary\": \"...\", \"synonyms\": [\"...\"], \"content\": {\"description\": \"...\", \"faq\": [{\"question\": \"...\", \"answer\": \"...\"}], \"troubleshooting\": [\"...\"], \"policies\": [{\"title\": \"...\", \"content\": \"...\"}], \"restrictedTopics\": [\"...\"]}}]. Keep answers short and factual.";

        const messages = [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: [
                    filename ? `Filename: ${filename}` : "",
                    "Content:",
                    rawContent,
                ]
                    .filter(Boolean)
                    .join("\n\n"),
            },
        ];

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model,
                messages,
                temperature: 0.2,
                response_format: { type: "json_object" },
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 20000,
            }
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
            throw new Error("OpenAI response missing content.");
        }

        const parsed = this.extractJson(content);
        if (!Array.isArray(parsed)) {
            if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).products)) {
                return (parsed as any).products;
            }
            throw new Error("OpenAI response did not contain a product array.");
        }

        return parsed;
    }

    private extractJson(raw: string): any {
        const trimmed = raw.trim();
        if (!trimmed) {
            throw new Error("Empty content from model.");
        }

        try {
            return JSON.parse(trimmed);
        } catch {
            // Try to locate a JSON block inside the text
            const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (match) {
                return JSON.parse(match[0]);
            }
            throw new Error("Failed to parse JSON from model response.");
        }
    }
}
