import { CompanyModel } from "../../business/models/CompanyModel";
import { CompanyInfoModel } from "../../business/models/CompanyInfoModel";
import { CompanyDetailsModel } from "../../business/models/CompanyDetailsModel";
import { CompanyContactModel } from "../../business/models/CompanyContactModel";
import { CompanyHourModel } from "../../business/models/CompanyHourModel";

export interface ICompanyRepository {
    // ---------- Company ----------
    createCompany(company: CompanyModel): Promise<void>;
    findByTwilioNumber(twilioNumber: string): Promise<CompanyModel | null>;
    findByEmail(email: string): Promise<CompanyModel | null>;
    findById(companyId: bigint): Promise<CompanyModel | null>;
    setCalendarConnected(companyId: bigint, connected: boolean): Promise<void>;
    saveAssistantId(companyId: bigint, assistantId: string): Promise<void>;

    // ---------- Company Info ----------
    addInfo(companyId: bigint, value: string): Promise<void>;
    removeInfo(infoId: number): Promise<void>;
    updateInfo(info: CompanyInfoModel): Promise<void>
    fetchInfo(companyId: bigint): Promise<CompanyInfoModel[]>;
    getCompanyIdForInfo(infoId: number): Promise<bigint | null>;

    // ---------- Company Details ----------
    addCompanyDetails(details: CompanyDetailsModel): Promise<void>;
    fetchCompanyDetails(companyId: bigint): Promise<CompanyDetailsModel | null>;
    updateCompanyDetails(details: CompanyDetailsModel): Promise<void>;
    deleteCompanyDetails(detailsId: number): Promise<void>;
    getCompanyIdForDetails(detailsId: number): Promise<bigint | null>;

    // ---------- Company Contacts ----------
    addCompanyContact(contact: CompanyContactModel): Promise<void>;
    fetchCompanyContact(companyId: bigint): Promise<CompanyContactModel | null>;
    updateCompanyContact(contact: CompanyContactModel): Promise<void>;
    deleteCompanyContact(contactId: number): Promise<void>;
    getCompanyIdForContact(contactId: number): Promise<bigint | null>;

    // ---------- Company Hours ----------
    addCompanyHour(hour: CompanyHourModel): Promise<void>;
    fetchCompanyHours(companyId: bigint): Promise<CompanyHourModel[]>;
    updateCompanyHour(hour: CompanyHourModel): Promise<void>;
    deleteCompanyHour(hourId: number): Promise<void>;
    getCompanyIdForHour(hourId: number): Promise<bigint | null>;
}
