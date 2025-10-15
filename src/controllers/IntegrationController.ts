import {container} from "tsyringe";
import {IntegrationService} from "../business/services/IntegrationService";

export class IntegrationController {
    private get service(): IntegrationService {
        return container.resolve(IntegrationService);
    }

    public async getAllIntegrations(req: any, res: any): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const integrations = await this.service.getAllWithStatus(companyId);
            res.json(integrations.map(integration => integration.toJSON()));
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error fetching integrations" });
        }
    }

    public async hasCalendarConnected(req: any, res: any): Promise<void> {
        try {
            const companyIdParam = req.params.id;
            if (!companyIdParam) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            let companyId: bigint;
            try {
                companyId = BigInt(companyIdParam);
            } catch {
                res.status(400).json({ message: "Invalid company identifier." });
                return;
            }
            const hasConnected = await this.service.hasCalendarConnected(companyId);
            res.json({ hasConnected });
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error checking calendar connection" });
        }
    }
}