import { Response } from "express";
import { container } from "tsyringe";
import { AnalyticsService } from "../business/services/AnalyticsService";
import { AuthenticatedRequest } from "../middleware/auth";

export class AnalyticsController {
    private readonly service: AnalyticsService;

    constructor() {
        this.service = container.resolve(AnalyticsService);
    }

    public async getCallOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }

            const overview = await this.service.getCallOverview(companyId);
            res.json(overview);
        } catch (error) {
            console.error("Failed to fetch call analytics overview", error);
            res.status(500).json({ message: "Failed to fetch analytics overview." });
        }
    }
}
