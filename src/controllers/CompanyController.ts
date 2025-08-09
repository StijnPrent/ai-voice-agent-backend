// src/controllers/CompanyController.ts
import { Request, Response } from "express";
import { container } from "tsyringe";
import { CompanyService } from "../business/services/CompanyService";
import { AuthenticatedRequest } from "../middleware/auth";
import {CompanyHourModel} from "../business/models/CompanyHourModel";
import {CompanyDetailsModel} from "../business/models/CompanyDetailsModel";
import {CompanyContactModel} from "../business/models/CompanyContactModel";

export class CompanyController {
    private get service(): CompanyService {
        return container.resolve(CompanyService);
    }

    // ---------- Company ----------
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

    // ---------- Company Info ----------
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

    public async updateInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { value, id } = req.body;
            await this.service.updateInfo(Number(id), value);
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating info");
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
            const payload = list.map(model => model.toJSON());
            res.json(payload);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching info");
        }
    }

    // ---------- Company Details ----------
    public async addCompanyDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            const { name, industry, size, foundedYear, description } = req.body;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            await this.service.addCompanyDetails(
                companyId,
                name,
                industry,
                size,
                foundedYear,
                description
            );
            res.status(201).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding company details");
        }
    }

    public async getCompanyDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const details = await this.service.getCompanyDetails(companyId);
            if (!details) {
                res.status(404).send("Details not found");
                return;
            }
            res.json(details);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching company details");
        }
    }

    public async updateCompanyDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { name, industry, size, foundedYear, description } = req.body;
            const companyId = req.companyId!;
            await this.service.updateCompanyDetails(
                new CompanyDetailsModel(
                    0,
                    companyId,
                    name,
                    industry,
                    size,
                    foundedYear,
                    description
                )
            );
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating company details");
        }
    }

    public async deleteCompanyDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            await this.service.deleteCompanyDetails(Number(id));
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error deleting company details");
        }
    }

    // ---------- Company Contacts ----------
    public async addCompanyContact(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            const { website, phone, contact_email ,address } = req.body;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            await this.service.addCompanyContact(companyId, website, phone, contact_email, address);
            res.status(201).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding company contact");
        }
    }

    public async getCompanyContact(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const contact = await this.service.getCompanyContact(companyId);
            if (!contact) {
                res.status(404).send("Contact not found");
                return;
            }
            res.json(contact);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching company contact");
        }
    }

    public async updateCompanyContact(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { website, phone, contact_email, address } = req.body;
            const companyId = req.companyId!;
            await this.service.updateCompanyContact(
                new CompanyContactModel(
                    0,
                    companyId,
                    website,
                    phone,
                    contact_email,
                    address
                )
            );
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating company contact");
        }
    }

    public async deleteCompanyContact(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            await this.service.deleteCompanyContact(Number(id));
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error deleting company contact");
        }
    }

    // ---------- Company Hours ----------
    public async addCompanyHour(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            const { dayOfWeek, isOpen, openTime, closeTime } = req.body;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            await this.service.addCompanyHour(companyId, dayOfWeek, isOpen, openTime, closeTime);
            res.status(201).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding company hour");
        }
    }

    public async getCompanyHours(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const hours = await this.service.getCompanyHours(companyId);
            res.json(hours);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching company hours");
        }
    }

    public async updateCompanyHour(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id, dayOfWeek, isOpen, openTime, closeTime } = req.body;
            const companyId = req.companyId!;
            await this.service.updateCompanyHour(
                new CompanyHourModel(
                    id,
                    companyId,
                    dayOfWeek,
                    isOpen,
                    openTime,
                    closeTime
                )
            );
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating company hour");
        }
    }

    public async deleteCompanyHour(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            await this.service.deleteCompanyHour(Number(id));
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error deleting company hour");
        }
    }
}