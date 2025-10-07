import { injectable, inject } from "tsyringe";
import { ISchedulingRepository } from "../../data/interfaces/ISchedulingRepository";
import { AppointmentTypeModel } from "../models/AppointmentTypeModel";
import { StaffMemberModel } from "../models/StaffMemberModel";
import { SpecialtyModel } from "../models/SpecialtyModel";
import { StaffAvailabilityModel } from "../models/StaffAvailabilityModel";
import { AssistantSyncService } from "./AssistantSyncService";

@injectable()
export class SchedulingService {
    constructor(
        @inject("ISchedulingRepository") private schedulingRepo: ISchedulingRepository,
        @inject(AssistantSyncService) private readonly assistantSyncService: AssistantSyncService
    ) {}

    // Appointment Types
    public async getAppointmentTypes(companyId: bigint): Promise<AppointmentTypeModel[]> {
        return this.schedulingRepo.fetchAppointmentTypes(companyId);
    }

    public async addAppointmentType(companyId: bigint, serviceName: string, durationMinutes: number, price: number | null, category: string | null, description: string | null): Promise<number> {
        const appointmentType = new AppointmentTypeModel(0, companyId, serviceName, durationMinutes, price, category, description);
        const id = await this.schedulingRepo.addAppointmentType(appointmentType);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return id;
    }

    public async updateAppointmentType(appointmentType: AppointmentTypeModel): Promise<void> {
        await this.schedulingRepo.updateAppointmentType(appointmentType);
        await this.assistantSyncService.syncCompanyAssistant(appointmentType.companyId);
    }

    public async deleteAppointmentType(companyId: bigint, appointmentTypeId: number): Promise<void> {
        await this.schedulingRepo.deleteAppointmentType(companyId, appointmentTypeId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
    }

    // Staff Members
    public async getStaffMembers(companyId: bigint): Promise<StaffMemberModel[]> {
        return this.schedulingRepo.fetchStaffMembers(companyId);
    }

    public async addStaffMember(companyId: bigint, name: string, specialties: SpecialtyModel[], role: string, availability: StaffAvailabilityModel[]): Promise<number> {
        const staffMember = new StaffMemberModel(0, companyId, name, specialties, role, availability);
        const id = await this.schedulingRepo.addStaffMember(staffMember);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return id;
    }

    public async updateStaffMember(staffMember: StaffMemberModel): Promise<void> {
        await this.schedulingRepo.updateStaffMember(staffMember);
        await this.assistantSyncService.syncCompanyAssistant(staffMember.companyId);
    }

    public async deleteStaffMember(companyId: bigint, staffMemberId: number): Promise<void> {
        await this.schedulingRepo.deleteStaffMember(companyId, staffMemberId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
    }

    public async getSchedulingContext(companyId: bigint) {
        const appointmentTypes = await this.getAppointmentTypes(companyId);
        const staffMembers = await this.getStaffMembers(companyId);

        return {
            appointmentTypes,
            staffMembers,
        };
    }
}
