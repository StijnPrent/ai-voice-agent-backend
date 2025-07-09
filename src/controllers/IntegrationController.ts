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
            res.json(integrations);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching integrations");
        }
    }
}