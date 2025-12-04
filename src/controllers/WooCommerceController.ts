import { Response } from "express";
import { container } from "tsyringe";
import { WooCommerceService } from "../business/services/WooCommerceService";
import { AuthenticatedRequest } from "../middleware/auth";

export class WooCommerceController {
    private get service(): WooCommerceService {
        return container.resolve(WooCommerceService);
    }

    public connect = async (req: AuthenticatedRequest, res: Response) => {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID missing from token." });
                return;
            }
            const storeUrl = typeof req.body?.storeUrl === "string" ? req.body.storeUrl.trim() : "";
            const consumerKey = typeof req.body?.consumerKey === "string" ? req.body.consumerKey.trim() : "";
            const consumerSecret = typeof req.body?.consumerSecret === "string" ? req.body.consumerSecret.trim() : "";
            const apiVersion = typeof req.body?.apiVersion === "string" ? req.body.apiVersion.trim() : undefined;

            if (!storeUrl || !consumerKey || !consumerSecret) {
                res.status(400).json({ message: "storeUrl, consumerKey and consumerSecret are required" });
                return;
            }

            await this.service.connect(companyId, { storeUrl, consumerKey, consumerSecret, apiVersion });
            res.status(201).json({ message: "WooCommerce connected" });
        } catch (error: any) {
            console.error("[WooCommerceController] connect failed", error);
            res.status(500).json({ message: error?.message || "Failed to connect WooCommerce." });
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
                storeUrl: integration?.storeUrl ?? null,
                apiVersion: integration?.apiVersion ?? null,
                connectedAt: integration?.connectedAt ?? null,
                updatedAt: integration?.updatedAt ?? null,
            });
        } catch (error: any) {
            console.error("[WooCommerceController] status failed", error);
            res.status(500).json({ message: "Failed to fetch WooCommerce status." });
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
            console.error("[WooCommerceController] disconnect failed", error);
            res.status(500).json({ message: "Failed to disconnect WooCommerce." });
        }
    };
}
