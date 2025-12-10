import { injectable, inject } from "tsyringe";
import { ISchedulingRepository } from "../../data/interfaces/ISchedulingRepository";
import { AppointmentTypeModel } from "../models/AppointmentTypeModel";
import { AppointmentCategoryModel } from "../models/AppointmentCategoryModel";
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

    public async addAppointmentType(companyId: bigint, input: AppointmentTypeInput): Promise<AppointmentTypeModel> {
        const categoryId = await this.resolveCategoryId(companyId, {
            categoryId: input.categoryId,
            newCategoryName: input.newCategoryName,
        });
        const appointmentType = new AppointmentTypeModel(
            0,
            companyId,
            input.name,
            input.durationMinutes,
            input.price ?? null,
            input.description ?? null,
            null,
            undefined,
            undefined,
            categoryId ?? null,
        );
        const id = await this.schedulingRepo.addAppointmentType(appointmentType);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        const created = await this.schedulingRepo.fetchAppointmentType(companyId, id);
        return created ?? new AppointmentTypeModel(
            id,
            companyId,
            input.name,
            input.durationMinutes,
            input.price ?? null,
            input.description ?? null,
        );
    }

    public async updateAppointmentType(companyId: bigint, input: AppointmentTypeUpdateInput): Promise<AppointmentTypeModel | null> {
        const existing = await this.schedulingRepo.fetchAppointmentType(companyId, input.id);
        if (!existing) {
            throw new Error("Appointment type not found");
        }

        const categoryId = await this.resolveCategoryId(companyId, {
            categoryId: input.categoryId,
            newCategoryName: input.newCategoryName,
            fallbackCategoryId: existing.categoryId,
        });

        const categoryModel = existing.category && existing.category.id === categoryId ? existing.category : null;
        const appointmentType = new AppointmentTypeModel(
            input.id,
            companyId,
            input.name,
            input.durationMinutes,
            input.price ?? null,
            input.description ?? null,
            categoryModel,
            existing.createdAt,
            existing.updatedAt,
            categoryId ?? null,
        );
        await this.schedulingRepo.updateAppointmentType(appointmentType);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return this.schedulingRepo.fetchAppointmentType(companyId, input.id);
    }

    public async deleteAppointmentType(companyId: bigint, appointmentTypeId: number): Promise<void> {
        await this.schedulingRepo.deleteAppointmentType(companyId, appointmentTypeId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
    }

    // Appointment Categories
    public async getAppointmentCategories(companyId: bigint): Promise<AppointmentCategoryModel[]> {
        return this.schedulingRepo.fetchAppointmentCategories(companyId);
    }

    public async addAppointmentCategory(companyId: bigint, name: string): Promise<AppointmentCategoryModel> {
        const normalized = name.trim();
        if (!normalized) {
            throw new Error("Category name is required.");
        }
        const category = new AppointmentCategoryModel(0, companyId, normalized);
        const id = await this.schedulingRepo.addAppointmentCategory(category);
        return new AppointmentCategoryModel(id, companyId, normalized);
    }

    public async updateAppointmentCategory(companyId: bigint, categoryId: number, name: string): Promise<void> {
        const normalized = name.trim();
        if (!normalized) {
            throw new Error("Category name is required.");
        }
        await this.schedulingRepo.updateAppointmentCategory(new AppointmentCategoryModel(categoryId, companyId, normalized));
    }

    public async deleteAppointmentCategory(companyId: bigint, categoryId: number): Promise<void> {
        await this.schedulingRepo.deleteAppointmentCategory(companyId, categoryId);
    }

    // Staff Members
    public async getStaffMembers(companyId: bigint): Promise<StaffMemberModel[]> {
        return this.schedulingRepo.fetchStaffMembers(companyId);
    }

    private normalizeCalendarField(value: unknown): string | null {
        if (typeof value !== "string") {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    public async addStaffMember(
        companyId: bigint,
        name: string,
        specialties: SpecialtyModel[],
        role: string,
        availability: StaffAvailabilityModel[],
        googleCalendarId?: string | null,
        googleCalendarSummary?: string | null
    ): Promise<number> {
        const calendarId = this.normalizeCalendarField(googleCalendarId);
        const calendarSummary = this.normalizeCalendarField(googleCalendarSummary);
        const staffMember = new StaffMemberModel(
            0,
            companyId,
            name,
            specialties,
            role,
            availability,
            calendarId,
            calendarSummary
        );
        const id = await this.schedulingRepo.addStaffMember(staffMember);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return id;
    }

    public async updateStaffMember(staffMember: StaffMemberModel): Promise<void> {
        const normalized = new StaffMemberModel(
            staffMember.id,
            staffMember.companyId,
            staffMember.name,
            staffMember.specialties,
            staffMember.role,
            staffMember.availability,
            this.normalizeCalendarField(staffMember.googleCalendarId),
            this.normalizeCalendarField(staffMember.googleCalendarSummary)
        );
        await this.schedulingRepo.updateStaffMember(normalized);
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

    private async resolveCategoryId(
        companyId: bigint,
        options: { categoryId?: number | null; newCategoryName?: string | null; fallbackCategoryId?: number | null }
    ): Promise<number | null> {
        const { categoryId, newCategoryName, fallbackCategoryId } = options;

        if (typeof newCategoryName === "string") {
            const trimmed = newCategoryName.trim();
            if (trimmed.length > 0) {
                const created = await this.addAppointmentCategory(companyId, trimmed);
                return created.id;
            }
        }

        if (categoryId === undefined) {
            return fallbackCategoryId ?? null;
        }

        if (typeof categoryId === "number" && categoryId > 0) {
            return categoryId;
        }

        if (categoryId === null) {
            return null;
        }

        return fallbackCategoryId ?? null;
    }
}

type AppointmentTypeInput = {
    name: string;
    durationMinutes: number;
    price?: number | null;
    description?: string | null;
    categoryId?: number | null;
    newCategoryName?: string | null;
};

type AppointmentTypeUpdateInput = AppointmentTypeInput & { id: number };
