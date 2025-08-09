import { injectable, inject } from "tsyringe";
import { ICompanyRepository } from "../../data/interfaces/ICompanyRepository";
import { IPasswordRepository } from "../../data/interfaces/IPasswordRepository";
import { CompanyModel } from "../models/CompanyModel";
import { CompanyInfoModel } from "../models/CompanyInfoModel";
import { CompanyDetailsModel } from "../models/CompanyDetailsModel";
import { CompanyContactModel } from "../models/CompanyContactModel";
import { CompanyHourModel } from "../models/CompanyHourModel";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

@injectable()
export class CompanyService {
    constructor(
        @inject("ICompanyRepository") private companyRepo: ICompanyRepository,
        @inject("IPasswordRepository") private passwordRepo: IPasswordRepository
    ) {}

    // Create and authenticate companies
    public async create(
        name: string,
        email: string,
        twilioNumber: string,
        website: string,
        password: string
    ): Promise<void> {
        const bytes = crypto.randomBytes(8);
        const sanitizedTwilio = twilioNumber.replace(/\s+/g, "");
        const id = BigInt("0x" + bytes.toString("hex"));

        const company = new CompanyModel(
            id,
            name,
            email,
            sanitizedTwilio,
            new Date(),
            new Date()
        );
        await this.companyRepo.createCompany(company);

        const hash = await bcrypt.hash(password, 10);
        await this.passwordRepo.createPassword(id, hash);
    }

    public async login(email: string, password: string): Promise<string | null> {
        const company = await this.companyRepo.findByEmail(email);
        if (!company) return null;

        const storedHash = await this.passwordRepo.findCurrentPasswordByCompanyId(
            company.id
        );
        if (!storedHash) return null;

        const valid = await bcrypt.compare(password, storedHash);
        if (!valid) return null;

        const token = jwt.sign(
            { companyId: company.id.toString() },
            process.env.JWT_SECRET!,
            { expiresIn: "8h" }
        );
        return token;
    }

    public async findByTwilioNumber(twilio: string): Promise<CompanyModel> {
        const sanitized = twilio.replace(/\s+/g, "");
        const company = await this.companyRepo.findByTwilioNumber(sanitized);
        if (!company) throw new Error("Unknown company");
        return company;
    }

    public async setCalendarConnected(
        companyId: bigint,
        connected: boolean
    ): Promise<void> {
        await this.companyRepo.setCalendarConnected(companyId, connected);
    }

    // Company Info
    public async addInfo(companyId: bigint, value: string): Promise<void> {
        await this.companyRepo.addInfo(companyId, value);
    }

    public async getCompanyInfo(companyId: bigint): Promise<CompanyInfoModel[]> {
        return this.companyRepo.fetchInfo(companyId);
    }

    public async updateInfo(id: number, value: string): Promise<void> {
        const info = new CompanyInfoModel(id, value, new Date());
        await this.companyRepo.updateInfo(info);
    }

    public async removeInfo(infoId: number): Promise<void> {
        await this.companyRepo.removeInfo(infoId);
    }

    // Company Details
    public async addCompanyDetails(
        companyId: bigint,
        name: string,
        industry: string,
        size: string,
        foundedYear: number,
        description: string
    ): Promise<void> {
        const details = new CompanyDetailsModel(
            0,
            companyId,
            name,
            industry,
            size,
            foundedYear,
            description
        );
        await this.companyRepo.addCompanyDetails(details);
    }

    public async getCompanyDetails(
        companyId: bigint
    ): Promise<CompanyDetailsModel | null> {
        return this.companyRepo.fetchCompanyDetails(companyId);
    }

    public async updateCompanyDetails(
        details: CompanyDetailsModel
    ): Promise<void> {
        await this.companyRepo.updateCompanyDetails(details);
    }

    public async deleteCompanyDetails(detailsId: number): Promise<void> {
        await this.companyRepo.deleteCompanyDetails(detailsId);
    }

    // Company Contact
    public async addCompanyContact(
        companyId: bigint,
        website: string,
        phone: string,
        contact_email: string,
        address: string
    ): Promise<void> {
        const contact = new CompanyContactModel(
            0,
            companyId,
            website,
            phone,
            contact_email,
            address
        );
        await this.companyRepo.addCompanyContact(contact);
    }

    public async getCompanyContact(
        companyId: bigint
    ): Promise<CompanyContactModel | null> {
        return this.companyRepo.fetchCompanyContact(companyId);
    }

    public async updateCompanyContact(
        contact: CompanyContactModel
    ): Promise<void> {
        await this.companyRepo.updateCompanyContact(contact);
    }

    public async deleteCompanyContact(contactId: number): Promise<void> {
        await this.companyRepo.deleteCompanyContact(contactId);
    }

    // Company Hours
    public async addCompanyHour(
        companyId: bigint,
        dayOfWeek: number,
        isOpen: boolean,
        openTime: string | null,
        closeTime: string | null
    ): Promise<void> {
        const hour = new CompanyHourModel(
            0,
            companyId,
            dayOfWeek,
            isOpen,
            openTime,
            closeTime
        );
        await this.companyRepo.addCompanyHour(hour);
    }

    public async getCompanyHours(
        companyId: bigint
    ): Promise<CompanyHourModel[]> {
        return this.companyRepo.fetchCompanyHours(companyId);
    }

    public async updateCompanyHour(
        hour: CompanyHourModel
    ): Promise<void> {
        await this.companyRepo.updateCompanyHour(hour);
    }

    public async deleteCompanyHour(hourId: number): Promise<void> {
        await this.companyRepo.deleteCompanyHour(hourId);
    }
}
