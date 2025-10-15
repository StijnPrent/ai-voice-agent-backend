// src/controllers/CompanyController.ts
import { Request, Response } from "express";
import { container } from "tsyringe";
import { CompanyService } from "../business/services/CompanyService";
import { AuthenticatedRequest } from "../middleware/auth";
import { AssistantSyncError } from "../business/errors/AssistantSyncError";
import { InvalidAccessCodeError } from "../business/errors/InvalidAccessCodeError";
import { CompanyDetailsModel } from "../business/models/CompanyDetailsModel";
import { CompanyContactModel } from "../business/models/CompanyContactModel";
import { CompanyHourModel } from "../business/models/CompanyHourModel";

export class CompanyController {
    private get service(): CompanyService {
        return container.resolve(CompanyService);
    }

    private handleError(res: Response, err: unknown, defaultMessage: string): void {
        if (err instanceof AssistantSyncError) {
            console.error(err);
            res.status(err.statusCode).json({ messages: err.messages });
            return;
        }

        console.error(err);
        res.status(500).json({ message: defaultMessage });
    }

    private static mapDetails(details: CompanyDetailsModel | null | undefined) {
        return {
            name: details?.name ?? "",
            industry: details?.industry ?? "",
            size: details?.size ?? "",
            foundedYear: details && details.foundedYear ? details.foundedYear : null,
            description: details?.description ?? "",
        };
    }

    private static mapContact(contact: CompanyContactModel | null | undefined) {
        const email = contact?.contact_email ?? "";
        return {
            website: contact?.website ?? "",
            phone: contact?.phone ?? "",
            contact_email: email,
            email,
            address: contact?.address ?? "",
        };
    }

    private static mapHour(hour: CompanyHourModel) {
        return {
            id: hour.id,
            dayOfWeek: hour.dayOfWeek,
            isOpen: hour.isOpen,
            openTime: hour.openTime,
            closeTime: hour.closeTime,
        };
    }

    private static toBoolean(value: unknown): boolean {
        if (typeof value === "boolean") {
            return value;
        }
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            return ["true", "1", "yes", "y"].includes(normalized);
        }
        if (typeof value === "number") {
            return value !== 0;
        }
        return Boolean(value);
    }

    // ---------- Authentication ----------
    public async registerCompany(req: Request, res: Response): Promise<void> {
        try {
            const { companyName, contactName, email, password, accessCode } = req.body ?? {};

            if (!companyName || !email || !password) {
                res.status(400).json({ message: "companyName, email, and password are required." });
                return;
            }

            await this.service.registerCompany({
                companyName: String(companyName),
                contactName: contactName ? String(contactName) : undefined,
                email: String(email),
                password: String(password),
                accessCode: accessCode ? String(accessCode) : undefined,
            });

            res.status(200).json({ message: "Registration successful." });
        } catch (err) {
            if (err instanceof InvalidAccessCodeError) {
                res.status(err.statusCode).json({ message: err.message });
                return;
            }
            this.handleError(res, err, "Error registering company");
        }
    }

    public async login(req: Request, res: Response): Promise<void> {
        try {
            const { email, password } = req.body ?? {};
            if (!email || !password) {
                res.status(400).json({ message: "Email and password are required." });
                return;
            }

            const token = await this.service.login(String(email), String(password));
            if (!token) {
                res.status(401).json({ message: "Invalid email or password." });
                return;
            }
            res.json({ token });
        } catch (err) {
            this.handleError(res, err, "Error logging in");
        }
    }

    public async getCompanyByNumber(req: Request, res: Response): Promise<void> {
        try {
            const { twilioNumber } = req.params;
            const company = await this.service.findByTwilioNumber(twilioNumber);
            res.json(company);
        } catch (err) {
            if (err instanceof Error && err.message.toLowerCase().includes("unknown company")) {
                res.status(404).json({ message: err.message });
                return;
            }
            this.handleError(res, err, "Error fetching company by number");
        }
    }

    // ---------- Company Info ----------
    public async getInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const list = await this.service.getCompanyInfo(companyId);
            res.json(list.map((model) => model.toJSON()));
        } catch (err) {
            this.handleError(res, err, "Error fetching info");
        }
    }

    public async addInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { value } = req.body ?? {};
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            if (!value || typeof value !== "string") {
                res.status(400).json({ message: "value is required." });
                return;
            }
            const info = await this.service.addInfo(companyId, value);
            res.status(201).json(info.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error adding info");
        }
    }

    public async updateInfo(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id, value } = req.body ?? {};
            if (typeof id !== "number" && typeof id !== "string") {
                res.status(400).json({ message: "id is required." });
                return;
            }
            if (!value || typeof value !== "string") {
                res.status(400).json({ message: "value is required." });
                return;
            }
            const updated = await this.service.updateInfo(Number(id), value);
            res.json(updated.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error updating info");
        }
    }

    public async removeInfo(req: Request, res: Response): Promise<void> {
        try {
            const { infoId } = req.params;
            await this.service.removeInfo(Number(infoId));
            res.status(204).send();
        } catch (err) {
            this.handleError(res, err, "Error removing info");
        }
    }

    // ---------- Company Details ----------
    public async getCompanyDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const details = await this.service.getCompanyDetails(companyId);
            res.json(CompanyController.mapDetails(details));
        } catch (err) {
            this.handleError(res, err, "Error fetching company details");
        }
    }

    public async updateCompanyDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const { name, industry, size, foundedYear, description } = req.body ?? {};
            const parsedYear = foundedYear === undefined || foundedYear === null
                ? undefined
                : Number(foundedYear);
            const saved = await this.service.saveCompanyDetails(companyId, {
                name: name ?? undefined,
                industry: industry ?? undefined,
                size: size ?? undefined,
                foundedYear: Number.isFinite(parsedYear) ? parsedYear : undefined,
                description: description ?? undefined,
            });
            res.json(CompanyController.mapDetails(saved));
        } catch (err) {
            this.handleError(res, err, "Error updating company details");
        }
    }

    // ---------- Company Contact ----------
    public async getCompanyContact(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const contact = await this.service.getCompanyContact(companyId);
            res.json(CompanyController.mapContact(contact));
        } catch (err) {
            this.handleError(res, err, "Error fetching company contact");
        }
    }

    public async updateCompanyContact(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const { website, phone, email, contact_email, address } = req.body ?? {};
            const saved = await this.service.saveCompanyContact(companyId, {
                website: website ?? undefined,
                phone: phone ?? undefined,
                email: email ?? undefined,
                contact_email: contact_email ?? undefined,
                address: address ?? undefined,
            });
            res.json(CompanyController.mapContact(saved));
        } catch (err) {
            this.handleError(res, err, "Error updating company contact");
        }
    }

    // ---------- Company Hours ----------
    public async getCompanyHours(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const hours = await this.service.getCompanyHours(companyId);
            res.json(hours.map(CompanyController.mapHour));
        } catch (err) {
            this.handleError(res, err, "Error fetching company hours");
        }
    }

    public async addCompanyHour(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const { dayOfWeek, isOpen, openTime, closeTime } = req.body ?? {};
            const parsedDay = Number(dayOfWeek);
            if (!Number.isFinite(parsedDay)) {
                res.status(400).json({ message: "dayOfWeek must be a number." });
                return;
            }
            const safeDay = Math.min(Math.max(Math.floor(parsedDay), 0), 6);
            const normalizedOpenTime =
                typeof openTime === "string" && openTime.trim().length > 0
                    ? openTime
                    : null;
            const normalizedCloseTime =
                typeof closeTime === "string" && closeTime.trim().length > 0
                    ? closeTime
                    : null;
            const saved = await this.service.addCompanyHour(
                companyId,
                safeDay,
                CompanyController.toBoolean(isOpen),
                normalizedOpenTime,
                normalizedCloseTime
            );
            res.status(201).json(CompanyController.mapHour(saved));
        } catch (err) {
            this.handleError(res, err, "Error adding company hour");
        }
    }

    public async updateCompanyHour(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const { id } = req.params;
            if (!id) {
                res.status(400).json({ message: "Hour id is required." });
                return;
            }
            const { dayOfWeek, isOpen, openTime, closeTime } = req.body ?? {};
            const parsedDay = Number(dayOfWeek);
            if (!Number.isFinite(parsedDay)) {
                res.status(400).json({ message: "dayOfWeek must be a number." });
                return;
            }
            const safeDay = Math.min(Math.max(Math.floor(parsedDay), 0), 6);
            const normalizedOpenTime =
                typeof openTime === "string" && openTime.trim().length > 0
                    ? openTime
                    : null;
            const normalizedCloseTime =
                typeof closeTime === "string" && closeTime.trim().length > 0
                    ? closeTime
                    : null;
            const hour = new CompanyHourModel(
                Number(id),
                companyId,
                safeDay,
                CompanyController.toBoolean(isOpen),
                normalizedOpenTime,
                normalizedCloseTime
            );
            const saved = await this.service.updateCompanyHour(hour);
            res.json(CompanyController.mapHour(saved));
        } catch (err) {
            this.handleError(res, err, "Error updating company hour");
        }
    }

    public async deleteCompanyHour(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            await this.service.deleteCompanyHour(Number(id));
            res.status(204).send();
        } catch (err) {
            this.handleError(res, err, "Error deleting company hour");
        }
    }
}
