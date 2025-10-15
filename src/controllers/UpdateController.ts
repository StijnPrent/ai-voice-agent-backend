import {UpdateService} from "../business/services/UpdateService";
import {container} from "tsyringe";
import { Request, Response } from "express";
import {AuthenticatedRequest} from "../middleware/auth";

export class UpdateController {
    private get service(): UpdateService {
        return container.resolve(UpdateService);
    }

    public async checkForUpdates(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const updates = await this.service.fetchUpdates(companyId);
            res.json(updates.map(update => update.toJSON()));
        } catch (err) {
            console.error(err);
            res.status(500).json({ message: "Error checking for updates" });
        }
    }
}