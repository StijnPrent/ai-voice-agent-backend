// src/controllers/CompanyController.ts

import { Request, Response } from "express";
import {container, inject, injectable} from "tsyringe";
import { CompanyService } from "../business/services/CompanyService";

container.register("CompanyService", { useClass: CompanyService });

@injectable()
export class CompanyController {
    /** POST /api/companies
     *  Body: { name: string; twilioNumber: string }
     */
    async createCompany(req: Request, res: Response) {
        try {
            const service = container.resolve(CompanyService);
            const { name, twilioNumber, website } = req.body;
            const company = await service.create(name, twilioNumber, website);
            res.status(201).json(company);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error creating company");
        }
    }

    /** GET /api/companies/:twilioNumber */
    async getCompanyByNumber(req: Request, res: Response) {
        try {
            const service = container.resolve(CompanyService);
            const { twilioNumber } = req.params;
            const company = await service.findByTwilioNumber(twilioNumber);
            res.json(company);
        } catch (err: any) {
            console.error(err);
            res.status(404).send(err.message);
        }
    }

    /** POST /api/companies/info
     *  Body: { companyId: string; value: string }
     */
    async addInfo(req: Request, res: Response) {
        try {
            const service = container.resolve(CompanyService);
            const { companyId, value } = req.body;
            const info = await service.addInfo(companyId, value);
            res.status(201).json(info);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding info");
        }
    }

    /** DELETE /api/companies/info/:infoId */
    async removeInfo(req: Request, res: Response) {
        try {
            const service = container.resolve(CompanyService);
            const { infoId } = req.params;
            await service.removeInfo(Number(infoId));
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error removing info");
        }
    }

    /** GET /api/companies/:companyId/info */
    async getInfo(req: Request, res: Response) {
        try {
            const service = container.resolve(CompanyService);
            const { companyId } = req.params;
            const list = await service.getCompanyInfo(BigInt(companyId));
            res.json(list);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching info");
        }
    }
}
