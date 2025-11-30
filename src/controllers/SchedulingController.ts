import { Response } from "express";
import { container } from "tsyringe";
import { SchedulingService } from "../business/services/SchedulingService";
import { AuthenticatedRequest } from "../middleware/auth";
import {StaffMemberModel} from "../business/models/StaffMemberModel";
import { AssistantSyncError } from "../business/errors/AssistantSyncError";

export class SchedulingController {
    private get service(): SchedulingService {
        return container.resolve(SchedulingService);
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

    // ---------- Appointment Types ----------
    public async getAppointmentTypes(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const list = await this.service.getAppointmentTypes(companyId);
            const payload = list.map(model => model.toJSON());
            res.json(payload);
        } catch (err) {
            this.handleError(res, err, "Error fetching appointment types");
        }
    }

    public async addAppointmentType(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { name, duration, price, description } = req.body;
            const { categoryId, newCategoryName } = this.extractCategoryPayload(req.body);
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const created = await this.service.addAppointmentType(companyId, {
                name,
                durationMinutes: duration,
                price: price ?? null,
                description: description ?? null,
                categoryId,
                newCategoryName,
            });
            res.status(201).json(created.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error adding appointment type");
        }
    }

    public async updateAppointmentType(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id, name, duration, price, description } = req.body;
            const { categoryId, newCategoryName } = this.extractCategoryPayload(req.body);
            const companyId = req.companyId!;
            const updated = await this.service.updateAppointmentType(companyId, {
                id,
                name,
                durationMinutes: duration,
                price: price ?? null,
                description: description ?? null,
                categoryId,
                newCategoryName,
            });
            res.json(updated?.toJSON() ?? null);
        } catch (err) {
            this.handleError(res, err, "Error updating appointment type");
        }
    }

    public async deleteAppointmentType(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            await this.service.deleteAppointmentType(companyId, Number(id));
            res.status(204).send();
        } catch (err) {
            this.handleError(res, err, "Error deleting appointment type");
        }
    }

    // ---------- Staff Members ----------
    public async getStaffMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const list = await this.service.getStaffMembers(companyId);
            const payload = list.map(model => model.toJSON());
            res.json(payload);
        } catch (err) {
            this.handleError(res, err, "Error fetching staff members");
        }
    }

    public async addStaffMember(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { name, specialties, role, availability, googleCalendarId, googleCalendarSummary } = req.body;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }

            const data = await this.service.addStaffMember(
                companyId,
                name,
                Array.isArray(specialties) ? specialties : [],
                role,
                Array.isArray(availability) ? availability : [],
                googleCalendarId,
                googleCalendarSummary
            );

            res.status(201).json({
                id: data,
                name,
                role,
                specialties,
                availability,
                googleCalendarId: googleCalendarId ?? null,
                googleCalendarSummary: googleCalendarSummary ?? null,
            });
        } catch (err) {
            this.handleError(res, err, "Error adding staff member");
        }
    }

    // ---------- Appointment Categories ----------
    public async getAppointmentCategories(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const categories = await this.service.getAppointmentCategories(companyId);
            res.json(categories.map(category => category.toJSON()));
        } catch (err) {
            this.handleError(res, err, "Error fetching appointment categories");
        }
    }

    public async addAppointmentCategory(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
            if (!name) {
                res.status(400).json({ message: "Category name is required" });
                return;
            }
            const category = await this.service.addAppointmentCategory(companyId, name);
            res.status(201).json(category.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error adding appointment category");
        }
    }

    public async updateAppointmentCategory(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const { id } = req.params;
            const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
            if (!id || !name) {
                res.status(400).json({ message: "Category id and name are required" });
                return;
            }
            await this.service.updateAppointmentCategory(companyId, Number(id), name);
            res.json({ id: Number(id), name });
        } catch (err) {
            this.handleError(res, err, "Error updating appointment category");
        }
    }

    public async deleteAppointmentCategory(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const { id } = req.params;
            if (!id) {
                res.status(400).json({ message: "Category id is required" });
                return;
            }
            await this.service.deleteAppointmentCategory(companyId, Number(id));
            res.status(204).send();
        } catch (err) {
            this.handleError(res, err, "Error deleting appointment category");
        }
    }

    public async updateStaffMember(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id, name, specialties, role, availability, googleCalendarId, googleCalendarSummary } = req.body;
            const companyId = req.companyId!;

            await this.service.updateStaffMember(
                new StaffMemberModel(
                    id,
                    companyId,
                    name,
                    Array.isArray(specialties) ? specialties : [],
                    role,
                    Array.isArray(availability) ? availability : [],
                    googleCalendarId ?? null,
                    googleCalendarSummary ?? null
                )
            );
            res.json({
                id,
                name,
                role,
                specialties,
                availability,
                googleCalendarId: googleCalendarId ?? null,
                googleCalendarSummary: googleCalendarSummary ?? null,
            });
        } catch (err) {
            this.handleError(res, err, "Error updating staff member");
        }
    }

    public async deleteStaffMember(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            await this.service.deleteStaffMember(companyId, Number(id));
            res.status(204).send();
        } catch (err) {
            this.handleError(res, err, "Error deleting staff member");
        }
    }

    private extractCategoryPayload(body: any): { categoryId?: number | null; newCategoryName?: string } {
        const categoryKeyPresent = Object.prototype.hasOwnProperty.call(body ?? {}, "categoryId");
        let categoryId: number | null | undefined = undefined;
        if (categoryKeyPresent) {
            if (body.categoryId === null || body.categoryId === "" || body.categoryId === undefined) {
                categoryId = null;
            } else {
                const parsed = Number(body.categoryId);
                categoryId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
            }
        }

        const rawNewCategory =
            typeof body?.newCategoryName === "string"
                ? body.newCategoryName
                : typeof body?.newCategory === "string"
                ? body.newCategory
                : undefined;
        const newCategoryName = rawNewCategory?.trim();

        return {
            categoryId: categoryKeyPresent ? categoryId ?? null : undefined,
            newCategoryName: newCategoryName && newCategoryName.length > 0 ? newCategoryName : undefined,
        };
    }
}
