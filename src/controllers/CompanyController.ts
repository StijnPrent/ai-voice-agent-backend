// src/controllers/CompanyController.ts
import { Request, Response } from "express";
import { container } from "tsyringe";
import { CompanyService } from "../business/services/CompanyService";
import { AuthenticatedRequest } from "../middleware/auth";

export class CompanyController {
    private get service(): CompanyService {
        return container.resolve(CompanyService);
    }

    public async createCompany(req: Request, res: Response): Promise<void> {
        try {
            const { name, email, twilioNumber, website, password } = req.body;
            await this.service.create(name, email, twilioNumber, website, password);
            res.status(201).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error creating company");
        }
    }

    public async login(req: Request, res: Response): Promise<void> {
        try {
            const { email, password } = req.body;
            const token = await this.service.login(email, password);
            if (!token) {
                res.status(401).send("Invalid credentials");
                return;
            }
            res.json({ token });
        } catch (err) {
            console.error(err);
            res.status(500).send("Error logging in");
        }
    }

    public async getCompanyByNumber(req: Request, res: Response): Promise<void> {
        try {
            const { twilioNumber } = req.params;
            const company = await this.service.findByTwilioNumber(twilioNumber);
            res.json(company);
        } catch (err: any) {
            console.error(err);
            res.status(404).send(err.message);
        }
    }

    public async addInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { value } = req.body;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            await this.service.addInfo(companyId, value);
            res.status(201).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding info");
        }
    }

    public async removeInfo(req: Request, res: Response): Promise<void> {
        try {
            const { infoId } = req.params;
            await this.service.removeInfo(Number(infoId));
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error removing info");
        }
    }

    public async getInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const list = await this.service.getCompanyInfo(companyId);
            res.json(list);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching info");
        }
    }
}
