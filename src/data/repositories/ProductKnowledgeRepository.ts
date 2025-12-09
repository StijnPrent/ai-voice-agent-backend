import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import {
    ProductKnowledgeModel,
    ProductStatus,
    ProductStructuredContent,
} from "../../business/models/ProductKnowledgeModel";
import { IProductKnowledgeRepository, ProductUpsertInput } from "../interfaces/IProductKnowledgeRepository";

type ProductRow = RowDataPacket & {
    id: number;
    company_id: string | number;
    name: string;
    sku?: string | null;
    summary?: string | null;
    status?: string | null;
    synonyms_json?: string | Buffer | null;
    content_json?: string | Buffer | null;
    version?: number | null;
    source?: string | null;
    created_at?: string | Date | null;
    updated_at?: string | Date | null;
};

export class ProductKnowledgeRepository extends BaseRepository implements IProductKnowledgeRepository {
    private parseJsonField<T>(raw: unknown, fallback: T): T {
        if (raw === null || typeof raw === "undefined") {
            return fallback;
        }

        if (typeof raw === "string") {
            try {
                return JSON.parse(raw) as T;
            } catch {
                return fallback;
            }
        }

        if (Buffer.isBuffer(raw)) {
            try {
                return JSON.parse(raw.toString("utf8")) as T;
            } catch {
                return fallback;
            }
        }

        if (typeof raw === "object") {
            return raw as T;
        }

        return fallback;
    }

    private mapRow(row: ProductRow): ProductKnowledgeModel {
        const synonyms = this.parseJsonField<string[] | undefined>(row.synonyms_json, []) ?? [];
        const content = this.parseJsonField<ProductStructuredContent | undefined>(row.content_json, {}) ?? {};

        const status = (row.status as ProductStatus | undefined) ?? "draft";
        const createdAt = row.created_at ? new Date(row.created_at) : new Date();
        const updatedAt = row.updated_at ? new Date(row.updated_at) : createdAt;

        return new ProductKnowledgeModel(
            Number(row.id),
            BigInt(row.company_id),
            row.name,
            row.sku ?? null,
            row.summary ?? null,
            status,
            synonyms,
            content,
            typeof row.version === "number" ? row.version : 1,
            row.source ?? null,
            updatedAt,
            createdAt
        );
    }

    public async listByCompany(companyId: bigint, status?: ProductStatus): Promise<ProductKnowledgeModel[]> {
        const filters: string[] = ["company_id = ?"];
        const params: any[] = [companyId];

        if (status) {
            filters.push("status = ?");
            params.push(status);
        }

        const sql = `
            SELECT
                id,
                company_id,
                name,
                sku,
                summary,
                status,
                synonyms_json,
                content_json,
                version,
                source,
                created_at,
                updated_at
            FROM company_products
            WHERE ${filters.join(" AND ")}
            ORDER BY updated_at DESC, id DESC
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, params);
        return rows.map((row) => this.mapRow(row as ProductRow));
    }

    public async getById(companyId: bigint, productId: number): Promise<ProductKnowledgeModel | null> {
        const sql = `
            SELECT
                id,
                company_id,
                name,
                sku,
                summary,
                status,
                synonyms_json,
                content_json,
                version,
                source,
                created_at,
                updated_at
            FROM company_products
            WHERE id = ? AND company_id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [productId, companyId]);
        if (rows.length === 0) {
            return null;
        }
        return this.mapRow(rows[0] as ProductRow);
    }

    private async insert(companyId: bigint, payload: ProductUpsertInput): Promise<ProductKnowledgeModel> {
        const sql = `
            INSERT INTO company_products
                (company_id, name, sku, summary, status, synonyms_json, content_json, version, source, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
        `;
        const synonyms = JSON.stringify(payload.synonyms ?? []);
        const content = JSON.stringify(payload.content ?? {});
        const params = [
            companyId,
            payload.name,
            payload.sku ?? null,
            payload.summary ?? null,
            payload.status ?? "draft",
            synonyms,
            content,
            payload.source ?? "manual",
        ];

        const result = await this.execute<ResultSetHeader>(sql, params);
        const insertedId = Number(result.insertId);
        const created = await this.getById(companyId, insertedId);
        if (!created) {
            throw new Error("Failed to fetch created product knowledge entry.");
        }
        return created;
    }

    public async create(companyId: bigint, payload: ProductUpsertInput): Promise<ProductKnowledgeModel> {
        return this.insert(companyId, payload);
    }

    public async update(companyId: bigint, productId: number, payload: ProductUpsertInput): Promise<ProductKnowledgeModel> {
        const sql = `
            UPDATE company_products
            SET
                name = ?,
                sku = ?,
                summary = ?,
                status = ?,
                synonyms_json = ?,
                content_json = ?,
                version = version + 1,
                source = ?,
                updated_at = NOW()
            WHERE id = ? AND company_id = ?
        `;

        const synonyms = JSON.stringify(payload.synonyms ?? []);
        const content = JSON.stringify(payload.content ?? {});
        const params = [
            payload.name,
            payload.sku ?? null,
            payload.summary ?? null,
            payload.status ?? "draft",
            synonyms,
            content,
            payload.source ?? "manual",
            productId,
            companyId,
        ];

        await this.execute<ResultSetHeader>(sql, params);
        const updated = await this.getById(companyId, productId);
        if (!updated) {
            throw new Error("Failed to update product knowledge entry.");
        }
        return updated;
    }

    public async bulkUpsert(
        companyId: bigint,
        payloads: ProductUpsertInput[],
        defaultStatus?: ProductStatus
    ): Promise<ProductKnowledgeModel[]> {
        const saved: ProductKnowledgeModel[] = [];

        for (const payload of payloads) {
            const status = payload.status ?? defaultStatus ?? "draft";
            const normalizedPayload: ProductUpsertInput = {
                ...payload,
                status,
            };

            if (payload.id) {
                const existing = await this.getById(companyId, payload.id);
                if (existing) {
                    saved.push(await this.update(companyId, payload.id, normalizedPayload));
                    continue;
                }
            }

            const sku = payload.sku?.trim();
            if (sku) {
                const existingBySku = await this.findBySku(companyId, sku);
                if (existingBySku) {
                    saved.push(
                        await this.update(companyId, existingBySku.id, normalizedPayload)
                    );
                    continue;
                }
            }

            saved.push(await this.insert(companyId, normalizedPayload));
        }

        return saved;
    }

    private async findBySku(companyId: bigint, sku: string): Promise<ProductKnowledgeModel | null> {
        const sql = `
            SELECT
                id,
                company_id,
                name,
                sku,
                summary,
                status,
                synonyms_json,
                content_json,
                version,
                source,
                created_at,
                updated_at
            FROM company_products
            WHERE company_id = ? AND sku = ?
            LIMIT 1
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, sku]);
        if (rows.length === 0) {
            return null;
        }
        return this.mapRow(rows[0] as ProductRow);
    }
}
