// src/controllers/UsageController.ts
import { Response } from "express";
import { container } from "tsyringe";
import { UsageService } from "../business/services/UsageService";
import { AuthenticatedRequest } from "../middleware/auth";

const MONTH_MIN = 1;
const MONTH_MAX = 12;
const YEAR_MIN = 2000;

const parseSingleQueryValue = (value: unknown): string | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value.length > 0 ? String(value[0]) : undefined;
    }

    return String(value);
};

const parseInteger = (value: string | undefined): number | undefined => {
    if (value === undefined) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
};

export class UsageController {
    private get service(): UsageService {
        return container.resolve(UsageService);
    }

    public async getMonthlyUsage(
        req: AuthenticatedRequest,
        res: Response
    ): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }

            const now = new Date();
            const monthParam = parseSingleQueryValue(req.query.month);
            const yearParam = parseSingleQueryValue(req.query.year);

            const month = parseInteger(monthParam) ?? now.getMonth() + 1;
            const year = parseInteger(yearParam) ?? now.getFullYear();

            if (month < MONTH_MIN || month > MONTH_MAX) {
                res.status(400).send("Month must be between 1 and 12.");
                return;
            }

            if (year < YEAR_MIN) {
                res.status(400).send("Year must be 2000 or later.");
                return;
            }

            const minutes = await this.service.getUsageMinutesForMonth(
                companyId,
                year,
                month
            );

            res.json({
                companyId: companyId.toString(),
                year,
                month,
                minutes,
            });
        } catch (error) {
            console.error("Failed to fetch monthly usage", error);
            res.status(500).send("Failed to fetch monthly usage");
        }
    }
}
