// src/data/interfaces/ICompanyRepository.ts
import { CompanyModel } from "../../business/models/CompanyModel";
import { CompanyInfoModel } from "../../business/models/CompanyInfoModel";

export interface ICompanyRepository {
    createCompany(company: CompanyModel): Promise<void>;
    findByTwilioNumber(twilioNumber: string): Promise<CompanyModel | null>;
    findByEmail(email: string): Promise<CompanyModel | null>;
    setCalendarConnected(companyId: bigint, connected: boolean): Promise<void>;
    addInfo(companyId: bigint, value: string): Promise<void>;
    removeInfo(infoId: number): Promise<void>;
    fetchInfo(companyId: bigint): Promise<CompanyInfoModel[]>;
}
