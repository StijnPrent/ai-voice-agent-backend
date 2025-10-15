import { Response } from "express";
import { container } from "tsyringe";
import { SchedulingService } from "../business/services/SchedulingService";
import { AuthenticatedRequest } from "../middleware/auth";
import {AppointmentTypeModel} from "../business/models/AppointmentTypeModel";
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
            const { name, duration, price, category, description } = req.body;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const id = await this.service.addAppointmentType(companyId, name, duration, price, category, description);
            res.status(201).json({
                id,
                name,
                duration,
                price: price ?? null,
                category: category ?? null,
                description: description ?? null,
            });
        } catch (err) {
            this.handleError(res, err, "Error adding appointment type");
        }
    }

    public async updateAppointmentType(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id, name, duration, price, category, description } = req.body;
            const companyId = req.companyId!;
            await this.service.updateAppointmentType(
                new AppointmentTypeModel(
                    id,
                    companyId,
                    name,
                    duration,
                    price,
                    category,
                    description
                )
            );
            res.json({
                id,
                name,
                duration,
                price: price ?? null,
                category: category ?? null,
                description: description ?? null,
            });
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
            const { name, specialties, role, availability } = req.body;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }

            const data = await this.service.addStaffMember(
                companyId,
                name,
                specialties,    // verwacht SpecialtyModel[] of {name:string}[]
                role,
                availability     // nieuw: StaffAvailabilityModel[]
            );

            res.status(201).json({
                id: data,
                name,
                role,
                specialties,
                availability,
            });
        } catch (err) {
            this.handleError(res, err, "Error adding staff member");
        }
    }

    public async updateStaffMember(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id, name, specialties, role, availability } = req.body;
            const companyId = req.companyId!;

            await this.service.updateStaffMember(
                new StaffMemberModel(
                    id,
                    companyId,
                    name,
                    specialties,
                    role,
                    availability
                )
            );
            res.json({
                id,
                name,
                role,
                specialties,
                availability,
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
}
