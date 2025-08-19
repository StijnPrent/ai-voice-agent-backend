import { injectable, inject } from "tsyringe";
import { ISchedulingRepository } from "../../data/interfaces/ISchedulingRepository";
import { AppointmentTypeModel } from "../models/AppointmentTypeModel";
import { StaffMemberModel } from "../models/StaffMemberModel";
import { SpecialtyModel } from "../models/SpecialtyModel";
import {StaffAvailabilityModel} from "../models/StaffAvailabilityModel";

@injectable()
export class SchedulingService {
    constructor(
        @inject("ISchedulingRepository") private schedulingRepo: ISchedulingRepository
    ) {}

    // Appointment Types
    public async getAppointmentTypes(companyId: bigint): Promise<AppointmentTypeModel[]> {
        return this.schedulingRepo.fetchAppointmentTypes(companyId);
    }

    public async addAppointmentType(companyId: bigint, serviceName: string, durationMinutes: number, price: number | null, category: string | null, description: string | null): Promise<number> {
        const appointmentType = new AppointmentTypeModel(0, companyId, serviceName, durationMinutes, price, category, description);
        return await this.schedulingRepo.addAppointmentType(appointmentType);
    }

    public async updateAppointmentType(appointmentType: AppointmentTypeModel): Promise<void> {
        await this.schedulingRepo.updateAppointmentType(appointmentType);
    }

    public async deleteAppointmentType(companyId: bigint, appointmentTypeId: number): Promise<void> {
        await this.schedulingRepo.deleteAppointmentType(companyId, appointmentTypeId);
    }

    // Staff Members
    public async getStaffMembers(companyId: bigint): Promise<StaffMemberModel[]> {
        return this.schedulingRepo.fetchStaffMembers(companyId);
    }

    public async addStaffMember(companyId: bigint, name: string, specialties: SpecialtyModel[], role: string, availability: StaffAvailabilityModel[]): Promise<number> {
        const staffMember = new StaffMemberModel(0, companyId, name, specialties, role, availability);
        return await this.schedulingRepo.addStaffMember(staffMember);
    }

    public async updateStaffMember(staffMember: StaffMemberModel): Promise<void> {
        await this.schedulingRepo.updateStaffMember(staffMember);
    }

    public async deleteStaffMember(companyId: bigint, staffMemberId: number): Promise<void> {
        await this.schedulingRepo.deleteStaffMember(companyId, staffMemberId);
    }

    public async getSchedulingContext(companyId: bigint) {
        const [appointmentTypes, staffMembers] = await Promise.all([
            this.getAppointmentTypes(companyId),
            this.getStaffMembers(companyId),
        ]);

        return {
            appointmentTypes,
            staffMembers,
        };
    }
}
