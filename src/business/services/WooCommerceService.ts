import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import { encrypt } from "../../utils/crypto";
import config from "../../config/config";
import { IWooCommerceRepository } from "../../data/interfaces/IWooCommerceRepository";
import { WooCommerceIntegrationModel } from "../models/WooCommerceIntegrationModel";
import { normalizeSimilarityScore } from "../../utils/stringSimilarity";
import axios from "axios";

@injectable()
export class WooCommerceService {
    constructor(
        @inject("IWooCommerceRepository") private readonly repo: IWooCommerceRepository
    ) {}

    public async getIntegration(companyId: bigint): Promise<WooCommerceIntegrationModel | null> {
        return this.repo.getIntegration(companyId);
    }

    public async connect(companyId: bigint, input: { storeUrl: string; consumerKey: string; consumerSecret: string; apiVersion?: string }): Promise<void> {
        const normalizedUrl = this.normalizeStoreUrl(input.storeUrl);
        const keyEnc = encrypt(input.consumerKey);
        const secretEnc = encrypt(input.consumerSecret);
        const version = input.apiVersion?.trim() || config.wooDefaultVersion || "wc/v3";

        await this.repo.upsertIntegration({
            companyId,
            storeUrl: normalizedUrl,
            encryptedConsumerKey: keyEnc.data,
            consumerKeyIv: keyEnc.iv,
            consumerKeyTag: keyEnc.tag,
            encryptedConsumerSecret: secretEnc.data,
            consumerSecretIv: secretEnc.iv,
            consumerSecretTag: secretEnc.tag,
            apiVersion: version,
        });
    }

    public async disconnect(companyId: bigint): Promise<void> {
        await this.repo.deleteIntegration(companyId);
    }

    public async getProductByName(companyId: bigint, name: string): Promise<{ id: string; name: string; raw: any }> {
        const integration = await this.ensureIntegration(companyId);
        const version = integration.apiVersion || config.wooDefaultVersion || "wc/v3";
        const url = `${integration.storeUrl}/wp-json/${version}/products`;

        const response = await axios.get(url, {
            params: {
                search: name,
                per_page: 20,
            },
            auth: {
                username: integration.consumerKey,
                password: integration.consumerSecret,
            },
        });

        const products: any[] = Array.isArray(response.data) ? response.data : [];
        if (!products.length) {
            throw new Error("No products found matching that name.");
        }

        const best = this.pickBestMatch(name, products, (p) => p.name ?? "");
        return { id: String(best.id), name: String(best.name ?? ""), raw: best };
    }

    public async getOrderStatus(companyId: bigint, orderId: string | number): Promise<{ id: string; status: string; raw: any }> {
        const integration = await this.ensureIntegration(companyId);
        const version = integration.apiVersion || config.wooDefaultVersion || "wc/v3";
        const cleanId = String(orderId).trim();
        if (!cleanId) {
            throw new Error("Order ID is required.");
        }
        const url = `${integration.storeUrl}/wp-json/${version}/orders/${encodeURIComponent(cleanId)}`;
        try {
            const response = await axios.get(url, {
                auth: {
                    username: integration.consumerKey,
                    password: integration.consumerSecret,
                },
            });
            const order = response.data;
            if (!order) {
                throw new Error("Order not found.");
            }
            return { id: String(order.id), status: order.status ?? "unknown", raw: order };
        } catch (err: any) {
            if (err?.response?.status === 404) {
                throw new Error("Order not found.");
            }
            throw err;
        }
    }

    public async listProducts(
        companyId: bigint,
        limit: number = 10
    ): Promise<Array<{ id: string; name: string; price?: string | null; sku?: string | null; summary?: string | null }>> {
        const integration = await this.ensureIntegration(companyId);
        const version = integration.apiVersion || config.wooDefaultVersion || "wc/v3";
        const sanitizedLimit = Math.min(20, Math.max(1, Math.floor(limit)));
        const url = `${integration.storeUrl}/wp-json/${version}/products`;

        const response = await axios.get(url, {
            params: {
                per_page: sanitizedLimit,
                status: "publish",
            },
            auth: {
                username: integration.consumerKey,
                password: integration.consumerSecret,
            },
        });

        const products: any[] = Array.isArray(response.data) ? response.data : [];
        return products.slice(0, sanitizedLimit).map((p) => ({
            id: String(p.id),
            name: String(p.name ?? ""),
            price: p.price ? String(p.price) : null,
            sku: p.sku ?? null,
            summary: typeof p.short_description === "string" ? p.short_description : null,
        }));
    }

    private normalizeStoreUrl(url: string): string {
        const trimmed = (url || "").trim();
        if (!trimmed) {
            throw new Error("Store URL is required.");
        }
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        return withProtocol.replace(/\/+$/, "");
    }

    private async ensureIntegration(companyId: bigint): Promise<WooCommerceIntegrationModel> {
        const integration = await this.repo.getIntegration(companyId);
        if (!integration) {
            throw new Error("WooCommerce is not connected for this company.");
        }
        return integration;
    }

    private pickBestMatch<T>(query: string, items: T[], getName: (item: T) => string): T {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
            throw new Error("Product name is required.");
        }
        let bestScore = -1;
        let bestItems: T[] = [];

        for (const item of items) {
            const name = getName(item);
            const score = normalizeSimilarityScore(normalizedQuery, name);
            if (score > bestScore) {
                bestScore = score;
                bestItems = [item];
            } else if (score === bestScore) {
                bestItems.push(item);
            }
        }

        if (bestScore < 0.2) {
            throw new Error("No sufficiently close product match found.");
        }
        if (bestItems.length > 1) {
            throw new Error("Multiple products match that name; please be more specific.");
        }
        return bestItems[0];
    }
}
