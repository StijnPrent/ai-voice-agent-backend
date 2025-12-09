import { Response } from "express";
import { container } from "tsyringe";
import { ProductKnowledgeService } from "../business/services/ProductKnowledgeService";
import { AuthenticatedRequest } from "../middleware/auth";
import { ProductStatus, ProductKnowledgeModel } from "../business/models/ProductKnowledgeModel";
import { ProductUpsertInput } from "../data/interfaces/IProductKnowledgeRepository";

export class ProductKnowledgeController {
    private get service(): ProductKnowledgeService {
        return container.resolve(ProductKnowledgeService);
    }

    private requireCompanyId(req: AuthenticatedRequest): bigint {
        if (!req.companyId) {
            throw new Error("Missing authenticated company context.");
        }
        return req.companyId;
    }

    private toJson(product: ProductKnowledgeModel) {
        return product.toJSON();
    }

    public async list(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = this.requireCompanyId(req);
            const status =
                typeof req.query.status === "string" &&
                (req.query.status === "draft" || req.query.status === "published")
                    ? (req.query.status as ProductStatus)
                    : undefined;

            const products = await this.service.listCatalog(companyId, status);
            res.json({ products: products.map((p) => p.toJSON()) });
        } catch (error) {
            console.error("[ProductKnowledgeController] list error", error);
            res.status(500).json({ message: "Failed to fetch product knowledge." });
        }
    }

    public async getById(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = this.requireCompanyId(req);
            const productId = Number(req.params.id);
            if (Number.isNaN(productId)) {
                res.status(400).json({ message: "Invalid product id." });
                return;
            }

            const product = await this.service.getProduct(companyId, productId);
            if (!product) {
                res.status(404).json({ message: "Product not found." });
                return;
            }

            res.json(this.toJson(product));
        } catch (error) {
            console.error("[ProductKnowledgeController] getById error", error);
            res.status(500).json({ message: "Failed to fetch product." });
        }
    }

    public async create(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = this.requireCompanyId(req);
            const body = (req.body ?? {}) as ProductUpsertInput;
            if (!body.name) {
                res.status(400).json({ message: "Product name is required." });
                return;
            }
            const saved = await this.service.upsertProduct(companyId, body);
            res.status(201).json(this.toJson(saved));
        } catch (error) {
            console.error("[ProductKnowledgeController] create error", error);
            res.status(500).json({ message: error instanceof Error ? error.message : "Failed to create product." });
        }
    }

    public async update(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = this.requireCompanyId(req);
            const productId = Number(req.params.id);
            if (Number.isNaN(productId)) {
                res.status(400).json({ message: "Invalid product id." });
                return;
            }
            const body = (req.body ?? {}) as ProductUpsertInput;
            if (!body.name) {
                res.status(400).json({ message: "Product name is required." });
                return;
            }

            const saved = await this.service.upsertProduct(companyId, { ...body, id: productId });
            res.json(this.toJson(saved));
        } catch (error) {
            console.error("[ProductKnowledgeController] update error", error);
            res.status(500).json({ message: error instanceof Error ? error.message : "Failed to update product." });
        }
    }

    public async ingest(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = this.requireCompanyId(req);
            const { content, filename, publish } = req.body ?? {};
            const rawContent = typeof content === "string" ? content : "";
            if (!rawContent.trim()) {
                res.status(400).json({ message: "Body must include 'content' with product context." });
                return;
            }

            const targetStatus: ProductStatus = publish ? "published" : "draft";
            const products = await this.service.ingestFromText(companyId, {
                rawContent,
                filename: typeof filename === "string" ? filename : undefined,
                targetStatus,
                source: "ingestion",
            });

            res.status(201).json({
                message: "Product knowledge ingested.",
                products: products.map((p) => p.toJSON()),
            });
        } catch (error) {
            console.error("[ProductKnowledgeController] ingest error", error);
            res.status(500).json({ message: error instanceof Error ? error.message : "Failed to ingest product data." });
        }
    }
}
