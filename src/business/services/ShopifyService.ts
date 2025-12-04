import "reflect-metadata";
import axios from "axios";
import crypto from "crypto";
import { inject, injectable } from "tsyringe";
import { encrypt } from "../../utils/crypto";
import config from "../../config/config";
import { IShopifyRepository } from "../../data/interfaces/IShopifyRepository";
import { ShopifyIntegrationModel } from "../models/ShopifyIntegrationModel";
import { normalizeSimilarityScore } from "../../utils/stringSimilarity";

@injectable()
export class ShopifyService {
    constructor(
        @inject("IShopifyRepository") private readonly repo: IShopifyRepository
    ) {}

    public async getIntegration(companyId: bigint): Promise<ShopifyIntegrationModel | null> {
        return this.repo.getIntegration(companyId);
    }

    public buildAuthUrl(companyId: bigint, shopDomain: string): { authUrl: string; state: string } {
        this.assertConfig();
        const normalizedShop = this.normalizeShopDomain(shopDomain);
        const state = this.generateState(companyId);
        const scopes = encodeURIComponent(config.shopifyScopes || "read_products,read_orders");
        const redirectUri = encodeURIComponent(config.shopifyRedirectUri || "");

        const authUrl = `https://${normalizedShop}/admin/oauth/authorize?client_id=${config.shopifyClientId}` +
            `&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

        return { authUrl, state };
    }

    public async handleCallback(companyId: bigint, code: string, shop: string): Promise<void> {
        this.assertConfig();
        const normalizedShop = this.normalizeShopDomain(shop);
        const tokenUrl = `https://${normalizedShop}/admin/oauth/access_token`;

        const response = await axios.post(tokenUrl, {
            client_id: config.shopifyClientId,
            client_secret: config.shopifyClientSecret,
            code,
        });

        if (!response.data?.access_token) {
            throw new Error("Invalid response from Shopify: access_token missing.");
        }

        const accessTokenEnc = encrypt(String(response.data.access_token));
        const scopes = Array.isArray(response.data.scope)
            ? response.data.scope.join(",")
            : typeof response.data.scope === "string"
                ? response.data.scope
                : null;

        await this.repo.upsertIntegration({
            companyId,
            shopDomain: normalizedShop,
            encryptedAccessToken: accessTokenEnc.data,
            accessTokenIv: accessTokenEnc.iv,
            accessTokenTag: accessTokenEnc.tag,
            scopes,
        });
    }

    public async disconnect(companyId: bigint): Promise<void> {
        await this.repo.deleteIntegration(companyId);
    }

    public async getProductByName(companyId: bigint, name: string): Promise<{ id: string; title: string; raw: any }> {
        const integration = await this.ensureIntegration(companyId);
        const version = config.shopifyApiVersion || "2024-07";
        const url = `https://${integration.shopDomain}/admin/api/${version}/products.json`;

        const response = await axios.get(url, {
            headers: {
                "X-Shopify-Access-Token": integration.accessToken,
                "Content-Type": "application/json",
            },
            params: {
                title: name,
                limit: 20,
            },
        });

        const products: any[] = Array.isArray(response.data?.products) ? response.data.products : [];
        if (!products.length) {
            throw new Error("No products found matching that name.");
        }

        const best = this.pickBestMatch(name, products, (p) => p.title ?? "");
        return { id: String(best.id), title: String(best.title ?? ""), raw: best };
    }

    public async getOrderStatus(companyId: bigint, orderId: string | number): Promise<{ id: string; status: string; raw: any }> {
        const integration = await this.ensureIntegration(companyId);
        const version = config.shopifyApiVersion || "2024-07";
        const cleanId = String(orderId).trim();
        if (!cleanId) {
            throw new Error("Order ID is required.");
        }
        const url = `https://${integration.shopDomain}/admin/api/${version}/orders/${encodeURIComponent(cleanId)}.json`;
        try {
            const response = await axios.get(url, {
                headers: {
                    "X-Shopify-Access-Token": integration.accessToken,
                    "Content-Type": "application/json",
                },
            });
            const order = response.data?.order;
            if (!order) {
                throw new Error("Order not found.");
            }
            return { id: String(order.id), status: order.financial_status ?? order.fulfillment_status ?? "unknown", raw: order };
        } catch (err: any) {
            if (err?.response?.status === 404) {
                throw new Error("Order not found.");
            }
            throw err;
        }
    }

    private assertConfig() {
        if (!config.shopifyClientId || !config.shopifyClientSecret || !config.shopifyRedirectUri) {
            throw new Error("Shopify credentials are not configured (SHOPIFY_CLIENT_ID/SECRET/REDIRECT_URI).");
        }
    }

    private normalizeShopDomain(shop: string): string {
        const trimmed = (shop || "").trim().toLowerCase();
        if (!trimmed) {
            throw new Error("Shop domain is required.");
        }
        if (!trimmed.endsWith(".myshopify.com")) {
            return `${trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "")}.myshopify.com`;
        }
        return trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    }

    private generateState(companyId: bigint): string {
        const nonce = crypto.randomBytes(12).toString("hex");
        return `${companyId.toString(16)}.${nonce}`;
    }

    private async ensureIntegration(companyId: bigint): Promise<ShopifyIntegrationModel> {
        const integration = await this.repo.getIntegration(companyId);
        if (!integration) {
            throw new Error("Shopify is not connected for this company.");
        }
        return integration;
    }

    private pickBestMatch<T>(query: string, items: T[], getName: (item: T) => string): T {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
            throw new Error("Product name is required.");
        }
        let bestScore = -1;
        let secondBest = -1;
        let bestItem: T | null = null;

        for (const item of items) {
            const name = getName(item);
            const score = normalizeSimilarityScore(normalizedQuery, name);
            if (score > bestScore) {
                secondBest = bestScore;
                bestScore = score;
                bestItem = item;
                continue;
            }
            if (score > secondBest) {
                secondBest = score;
            }
        }

        if (bestScore < 0.2 || !bestItem) {
            throw new Error("No sufficiently close product match found.");
        }
        // If another product is within a small band of the best score, treat as ambiguous.
        if (secondBest >= bestScore - 0.15) {
            throw new Error("Multiple products match that name; please be more specific.");
        }
        return bestItem;
    }
}
