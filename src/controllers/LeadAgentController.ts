import { Request, Response } from "express";
import { container } from "tsyringe";
import { LeadAgentService } from "../business/services/LeadAgentService";
import { ValidationError } from "../business/errors/ValidationError";

export class LeadAgentController {
    private get service(): LeadAgentService {
        return container.resolve(LeadAgentService);
    }

    public async run(req: Request, res: Response): Promise<void> {
        try {
            const result = await this.service.runLeadWorkflow(req.body?.prompt);
            res.json(result);
        } catch (error) {
            if (error instanceof ValidationError) {
                res.status(400).json({ message: error.message });
                return;
            }
            console.error("Lead agent execution failed:", error);
            res
                .status(500)
                .json({ message: "Lead agent could not complete the request." });
        }
    }
}
