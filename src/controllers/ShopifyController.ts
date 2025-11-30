import { Request, Response } from "express";
import { container } from "tsyringe";
import { ShopifyService } from "../business/services/ShopifyService";
import { AuthenticatedRequest } from "../middleware/auth";

export class ShopifyController {
    private get service(): ShopifyService {
        return container.resolve(ShopifyService);
    }

    public startAuth = async (req: AuthenticatedRequest, res: Response) => {
        try {
            const companyId = req.companyId;
            const shopDomain = typeof req.body?.shopDomain === "string" ? req.body.shopDomain.trim() : "";
            if (!companyId) {
                res.status(400).json({ message: "Company ID missing from token." });
                return;
            }
            if (!shopDomain) {
                res.status(400).json({ message: "shopDomain is required" });
                return;
            }
            const { authUrl, state } = this.service.buildAuthUrl(companyId, shopDomain);
            res.json({ authUrl, state });
        } catch (error: any) {
            console.error("[ShopifyController] startAuth failed", error);
            res.status(500).json({ message: error?.message || "Failed to start Shopify OAuth." });
        }
    };

    public handleCallback = async (req: Request, res: Response) => {
        try {
            const code = typeof req.query.code === "string" ? req.query.code : null;
            const shop = typeof req.query.shop === "string" ? req.query.shop : null;
            const state = typeof req.query.state === "string" ? req.query.state : null;
            if (!code || !shop || !state) {
                res.status(400).json({ message: "Missing code, shop, or state." });
                return;
            }

            const companyId = this.extractCompanyIdFromState(state);
            await this.service.handleCallback(companyId, code, shop);
            res.json({ message: "Shopify connected", shop, companyId: companyId.toString() });
        } catch (error: any) {
            console.error("[ShopifyController] callback failed", error);
            res.status(500).json({ message: error?.message || "Failed to complete Shopify OAuth." });
        }
    };

    public status = async (req: AuthenticatedRequest, res: Response) => {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID missing from token." });
                return;
            }
            const integration = await this.service.getIntegration(companyId);
            res.json({
                connected: Boolean(integration),
                shopDomain: integration?.shopDomain ?? null,
                scopes: integration?.scopes ?? null,
                installedAt: integration?.installedAt ?? null,
                updatedAt: integration?.updatedAt ?? null,
            });
        } catch (error: any) {
            console.error("[ShopifyController] status failed", error);
            res.status(500).json({ message: "Failed to fetch Shopify status." });
        }
    };

    public disconnect = async (req: AuthenticatedRequest, res: Response) => {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID missing from token." });
                return;
            }
            await this.service.disconnect(companyId);
            res.status(204).send();
        } catch (error: any) {
            console.error("[ShopifyController] disconnect failed", error);
            res.status(500).json({ message: "Failed to disconnect Shopify." });
        }
    };

    private extractCompanyIdFromState(state: string): bigint {
        const [hexId] = state.split(".");
        if (!hexId) {
            throw new Error("Invalid OAuth state.");
        }
        const id = BigInt(`0x${hexId}`);
        if (!id) {
            throw new Error("Invalid company id in OAuth state.");
        }
        return id;
    }
}
