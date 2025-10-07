// src/controllers/CallController.ts
import { Response } from "express";
import { container } from "tsyringe";
import { CallLogService } from "../business/services/CallLogService";
import { AuthenticatedRequest } from "../middleware/auth";

export class CallController {
    private readonly callLogService: CallLogService;

    constructor() {
        this.callLogService = container.resolve(CallLogService);
    }

    public async getCallerNumbers(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Missing authenticated company." });
                return;
            }

            const rawLimit = req.query.limit;

            let parsedLimit: number;
            if (typeof rawLimit === "string") {
                parsedLimit = rawLimit.trim().length ? Number(rawLimit) : NaN;
            } else if (Array.isArray(rawLimit)) {
                const first = rawLimit.find(
                  (v): v is string => typeof v === "string" && v.trim().length > 0
                );
                parsedLimit = first ? Number(first) : NaN;
            } else {
                parsedLimit = NaN;
            }

            const limit =
              Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

            const numbers = await this.callLogService.getCallerNumbers(companyId, limit);
            res.json({ phoneNumbers: numbers });
        } catch (error) {
            console.error("Failed to fetch caller numbers", error);
            res.status(500).json({ message: "Failed to fetch caller numbers." });
        }
    }


    public async getCallDetails(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Missing authenticated company." });
                return;
            }

            const { callSid } = req.params;
            if (!callSid) {
                res.status(400).json({ message: "callSid parameter is required." });
                return;
            }

            const details = await this.callLogService.getCallDetails(companyId, callSid);
            res.json(details);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to fetch call details.";
            const lowered = message.toLowerCase();
            const status = lowered.includes("not found")
                ? 404
                : lowered.includes("no vapi")
                    ? 409
                    : 400;
            if (status >= 500 || (!lowered.includes("no vapi") && status !== 404)) {
                console.error("Failed to fetch call details", error);
            }
            res.status(status).json({ message });
        }
    }
}
