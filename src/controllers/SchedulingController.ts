import { Response } from "express";
import { container } from "tsyringe";
import { SchedulingService } from "../business/services/SchedulingService";
import { AuthenticatedRequest } from "../middleware/auth";
import {AppointmentTypeModel} from "../business/models/AppointmentTypeModel";
import {StaffMemberModel} from "../business/models/StaffMemberModel";

export class SchedulingController {
    private get service(): SchedulingService {
        return container.resolve(SchedulingService);
    }

    // ---------- Appointment Types ----------
    public async getAppointmentTypes(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const list = await this.service.getAppointmentTypes(companyId);
            const payload = list.map(model => model.toJSON());
            res.json(payload);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching appointment types");
        }
    }

    public async addAppointmentType(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { name, duration, price, category, description } = req.body;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const data = await this.service.addAppointmentType(companyId, name, duration, price, category, description);
            res.status(201).send(data);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding appointment type");
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
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating appointment type");
        }
    }

    public async deleteAppointmentType(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            await this.service.deleteAppointmentType(companyId, Number(id));
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error deleting appointment type");
        }
    }

    // ---------- Staff Members ----------
    public async getStaffMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const list = await this.service.getStaffMembers(companyId);
            const payload = list.map(model => model.toJSON());
            res.json(payload);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching staff members");
        }
    }

    public async addStaffMember(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { name, specialties, role, availability } = req.body;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }

            const data = await this.service.addStaffMember(
                companyId,
                name,
                specialties,    // verwacht SpecialtyModel[] of {name:string}[]
                role,
                availability     // nieuw: StaffAvailabilityModel[]
            );

            res.status(201).send(data);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error adding staff member");
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

            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating staff member");
        }
    }

    public async deleteStaffMember(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            await this.service.deleteStaffMember(companyId, Number(id));
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error deleting staff member");
        }
    }
}
