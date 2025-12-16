import { CompanyModel } from "../../business/models/CompanyModel";
import { CompanyInfoModel } from "../../business/models/CompanyInfoModel";
import { CompanyDetailsModel } from "../../business/models/CompanyDetailsModel";
import { CompanyContactModel } from "../../business/models/CompanyContactModel";
import { CompanyHourModel } from "../../business/models/CompanyHourModel";
import { CompanyCallerModel } from "../../business/models/CompanyCallerModel";

export interface ICompanyRepository {
    // ---------- Company ----------
    createCompany(company: CompanyModel): Promise<void>;
    findByTwilioNumber(twilioNumber: string): Promise<CompanyModel | null>;
    findByEmail(email: string): Promise<CompanyModel | null>;
    findById(companyId: bigint): Promise<CompanyModel | null>;
    setCalendarConnected(companyId: bigint, connected: boolean): Promise<void>;
    saveAssistantId(companyId: bigint, assistantId: string): Promise<void>;
    setAssistantEnabled(companyId: bigint, enabled: boolean): Promise<void>;
    setAssistantOutsideHoursOnly(companyId: bigint, enabled: boolean): Promise<void>;
    markEmailVerified(companyId: bigint): Promise<void>;

    // ---------- Company Info ----------
    addInfo(companyId: bigint, value: string): Promise<CompanyInfoModel>;
    removeInfo(infoId: number): Promise<void>;
    updateInfo(info: CompanyInfoModel): Promise<CompanyInfoModel>;
    fetchInfo(companyId: bigint): Promise<CompanyInfoModel[]>;
    getCompanyIdForInfo(infoId: number): Promise<bigint | null>;
    findInfoById(infoId: number): Promise<CompanyInfoModel | null>;

    // ---------- Company Details ----------
    addCompanyDetails(details: CompanyDetailsModel): Promise<CompanyDetailsModel>;
    fetchCompanyDetails(companyId: bigint): Promise<CompanyDetailsModel | null>;
    updateCompanyDetails(details: CompanyDetailsModel): Promise<CompanyDetailsModel>;
    deleteCompanyDetails(detailsId: number): Promise<void>;
    getCompanyIdForDetails(detailsId: number): Promise<bigint | null>;

    // ---------- Company Contacts ----------
    addCompanyContact(contact: CompanyContactModel): Promise<void>;
    fetchCompanyContact(companyId: bigint): Promise<CompanyContactModel | null>;
    updateCompanyContact(contact: CompanyContactModel): Promise<void>;
    deleteCompanyContact(contactId: number): Promise<void>;
    getCompanyIdForContact(contactId: number): Promise<bigint | null>;

    // ---------- Company Hours ----------
    addCompanyHour(hour: CompanyHourModel): Promise<CompanyHourModel>;
    fetchCompanyHours(companyId: bigint): Promise<CompanyHourModel[]>;
    updateCompanyHour(hour: CompanyHourModel): Promise<CompanyHourModel>;
    deleteCompanyHour(hourId: number): Promise<void>;
    getCompanyIdForHour(hourId: number): Promise<bigint | null>;
    findCompanyHourByDay(companyId: bigint, dayOfWeek: number): Promise<CompanyHourModel | null>;
    findCompanyHourById(hourId: number): Promise<CompanyHourModel | null>;

    // ---------- Company Callers ----------
    addCompanyCaller(caller: CompanyCallerModel): Promise<CompanyCallerModel>;
    updateCompanyCaller(caller: CompanyCallerModel): Promise<CompanyCallerModel>;
    deleteCompanyCaller(callerId: number): Promise<void>;
    fetchCompanyCallers(companyId: bigint): Promise<CompanyCallerModel[]>;
    findCompanyCallerByPhone(companyId: bigint, phoneNumber: string): Promise<CompanyCallerModel | null>;
    findCompanyCallerById(callerId: number): Promise<CompanyCallerModel | null>;
    getCompanyIdForCaller(callerId: number): Promise<bigint | null>;
}
