import { Response } from "express";
import { container } from "tsyringe";
import { PhorestService } from "../business/services/PhorestService";
import { AuthenticatedRequest } from "../middleware/auth";
import { SchedulingService } from "../business/services/SchedulingService";

export class PhorestController {
    private get service(): PhorestService {
        return container.resolve(PhorestService);
    }

    private get schedulingService(): SchedulingService {
        return container.resolve(SchedulingService);
    }

    async connect(req: AuthenticatedRequest, res: Response): Promise<void> {
        const companyId = this.getCompanyId(req, res);
        if (!companyId) return;

        try {
            await this.service.connect(companyId, {
                businessId: String(req.body?.businessId ?? ""),
                branchId: String(req.body?.branchId ?? ""),
                username: String(req.body?.username ?? ""),
                password: String(req.body?.password ?? ""),
            });
            res.status(204).send();
        } catch (error) {
            console.error("[PhorestController] Failed to connect integration", error);
            res.status(500).json({ message: "Failed to connect Phorest integration." });
        }
    }

    async disconnect(req: AuthenticatedRequest, res: Response): Promise<void> {
        const companyId = this.getCompanyId(req, res);
        if (!companyId) return;

        try {
            await this.service.disconnect(companyId);
            res.status(204).send();
        } catch (error) {
            console.error("[PhorestController] Failed to disconnect integration", error);
            res.status(500).json({ message: "Failed to disconnect Phorest integration." });
        }
    }

    async getAppointments(req: AuthenticatedRequest, res: Response): Promise<void> {
        const companyId = this.getCompanyId(req, res);
        if (!companyId) return;

        try {
            const appointments = await this.service.getAppointments(companyId, req.query ?? undefined);
            res.json(appointments);
        } catch (error) {
            console.error("[PhorestController] Failed to fetch appointments", error);
            res.status(500).json({ message: "Failed to fetch Phorest appointments." });
        }
    }

    async confirmAppointments(req: AuthenticatedRequest, res: Response): Promise<void> {
        const companyId = this.getCompanyId(req, res);
        if (!companyId) return;

        const { clientId, date, payload } = req.body ?? {};
        if (!clientId || !date) {
            res.status(400).json({ message: "clientId and date are required." });
            return;
        }

        try {
            const response = await this.service.confirmAppointments(companyId, {
                clientId,
                date,
                payload,
            });
            res.json(response);
        } catch (error) {
            console.error("[PhorestController] Failed to confirm appointments", error);
            res.status(500).json({ message: "Failed to confirm Phorest appointments." });
        }
    }

    async cancelAppointments(req: AuthenticatedRequest, res: Response): Promise<void> {
        const companyId = this.getCompanyId(req, res);
        if (!companyId) return;

        const { appointmentIds, payload } = req.body ?? {};
        if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
            res.status(400).json({ message: "appointmentIds must be a non-empty array." });
            return;
        }

        try {
            const response = await this.service.cancelAppointments(companyId, {
                appointmentIds,
                payload,
            });
            res.json(response);
        } catch (error) {
            console.error("[PhorestController] Failed to cancel appointments", error);
            res.status(500).json({ message: "Failed to cancel Phorest appointments." });
        }
    }

    async listStaff(req: AuthenticatedRequest, res: Response): Promise<void> {
        const companyId = this.getCompanyId(req, res);
        if (!companyId) return;

        try {
            const staff = await this.service.listStaffMembers(companyId, req.query ?? undefined);
            res.json(staff);
        } catch (error) {
            console.error("[PhorestController] Failed to fetch Phorest staff", error);
            res.status(500).json({ message: "Failed to fetch Phorest staff." });
        }
    }

    async attachStaffMember(req: AuthenticatedRequest, res: Response): Promise<void> {
        const companyId = this.getCompanyId(req, res);
        if (!companyId) return;

        const staffIdParam = req.params?.staffMemberId;
        const phorestStaffId = typeof req.body?.phorestStaffId === "string" ? req.body.phorestStaffId.trim() : null;

        if (!staffIdParam) {
            res.status(400).json({ message: "staffMemberId is required." });
            return;
        }

        try {
            const staffId = Number(staffIdParam);
            if (!Number.isFinite(staffId)) {
                res.status(400).json({ message: "Invalid staffMemberId." });
                return;
            }

            await this.schedulingService.assignPhorestStaffId(companyId, staffId, phorestStaffId);
            res.status(204).send();
        } catch (error) {
            console.error("[PhorestController] Failed to assign Phorest staff", error);
            res.status(500).json({ message: "Failed to assign Phorest staff." });
        }
    }

    private getCompanyId(req: AuthenticatedRequest, res: Response): bigint | null {
        if (!req.companyId) {
            res.status(401).json({ message: "Missing authenticated company context." });
            return null;
        }
        return req.companyId;
    }
}
