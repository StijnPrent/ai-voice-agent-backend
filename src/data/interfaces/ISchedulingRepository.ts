import { AppointmentTypeModel } from "../../business/models/AppointmentTypeModel";
import { AppointmentCategoryModel } from "../../business/models/AppointmentCategoryModel";
import { StaffMemberModel } from "../../business/models/StaffMemberModel";
import { SpecialtyModel } from "../../business/models/SpecialtyModel";

export interface ISchedulingRepository {
    /* ----------------------------- Appointment Types ----------------------------- */
    addAppointmentType(model: AppointmentTypeModel): Promise<number>;
    updateAppointmentType(model: AppointmentTypeModel): Promise<void>;
    deleteAppointmentType(companyId: bigint, id: number): Promise<void>;
    fetchAppointmentTypes(companyId: bigint): Promise<AppointmentTypeModel[]>;
    fetchAppointmentType(companyId: bigint, id: number): Promise<AppointmentTypeModel | null>;

    /* ----------------------------- Appointment Categories ----------------------------- */
    addAppointmentCategory(model: AppointmentCategoryModel): Promise<number>;
    updateAppointmentCategory(model: AppointmentCategoryModel): Promise<void>;
    deleteAppointmentCategory(companyId: bigint, categoryId: number): Promise<void>;
    fetchAppointmentCategories(companyId: bigint): Promise<AppointmentCategoryModel[]>;

    /* --------------------------------- Staff ---------------------------------- */
    addStaffMember(model: StaffMemberModel): Promise<number>;
    updateStaffMember(model: StaffMemberModel): Promise<void>;
    deleteStaffMember(companyId: bigint, staffId: number): Promise<void>;
    fetchStaffMembers(companyId: bigint): Promise<StaffMemberModel[]>;
    updateStaffPhorestId(companyId: bigint, staffId: number, phorestStaffId: string | null): Promise<void>;

    /* ------------------------------ Specialties ------------------------------- */
    setStaffSpecialtiesFromModels(staffId: number, specialties: SpecialtyModel[]): Promise<void>;

    /* --------------------------- Staff ↔ Services ---------------------------- */
    linkStaffToService(staffId: number, appointmentTypeId: number): Promise<void>;
    unlinkStaffFromService(staffId: number, appointmentTypeId: number): Promise<void>;
    getStaffServiceIds(staffId: number): Promise<number[]>;
}
