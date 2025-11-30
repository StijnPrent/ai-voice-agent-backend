import { Response } from "express";
import { container } from "tsyringe";
import { AuthenticatedRequest } from "../middleware/auth";
import { ShopifyService } from "../business/services/ShopifyService";
import { WooCommerceService } from "../business/services/WooCommerceService";

export class CommerceController {
    private get shopifyService(): ShopifyService {
        return container.resolve(ShopifyService);
    }

    private get wooService(): WooCommerceService {
        return container.resolve(WooCommerceService);
    }

    public list = async (req: AuthenticatedRequest, res: Response) => {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID missing from token." });
                return;
            }

            const [shopify, woo] = await Promise.all([
                this.shopifyService.getIntegration(companyId),
                this.wooService.getIntegration(companyId),
            ]);

            res.json({
                shopify: shopify
                    ? {
                          connected: true,
                          shopDomain: shopify.shopDomain,
                          scopes: shopify.scopes ?? null,
                          installedAt: shopify.installedAt ?? null,
                          updatedAt: shopify.updatedAt ?? null,
                      }
                    : { connected: false },
                woocommerce: woo
                    ? {
                          connected: true,
                          storeUrl: woo.storeUrl,
                          apiVersion: woo.apiVersion,
                          connectedAt: woo.connectedAt ?? null,
                          updatedAt: woo.updatedAt ?? null,
                      }
                    : { connected: false },
            });
        } catch (error) {
            console.error("[CommerceController] list failed", error);
            res.status(500).json({ message: "Failed to list commerce integrations." });
        }
    };
}
