// src/business/services/CompanyService.ts
import { injectable, inject } from "tsyringe";
import { ICompanyRepository } from "../../data/interfaces/ICompanyRepository";
import { IPasswordRepository } from "../../data/interfaces/IPasswordRepository";
import { CompanyModel } from "../models/CompanyModel";
import { CompanyInfoModel } from "../models/CompanyInfoModel";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

@injectable()
export class CompanyService {
    constructor(
        @inject("ICompanyRepository") private companyRepo: ICompanyRepository,
        @inject("IPasswordRepository") private passwordRepo: IPasswordRepository
    ) {}

    public async create(name: string, email: string, twilioNumber: string, website: string, password: string): Promise<void> {
        const bytes = crypto.randomBytes(8);
        const sanitizedTwilioNumber = twilioNumber.replace(/\s+/g, "");
        const id = BigInt("0x" + bytes.toString("hex"));
        const company = new CompanyModel(
            id,
            name,
            email,
            sanitizedTwilioNumber,
            website,
            false,
            new Date(),
            new Date()
        );
        await this.companyRepo.createCompany(company);

        const passwordHash = await bcrypt.hash(password, 10);
        await this.passwordRepo.createPassword(id, passwordHash);
    }

    public async login(email: string, password: string): Promise<string | null> {
        const company = await this.companyRepo.findByEmail(email);
        if (!company) {
            return null;
        }

        const passwordHash = await this.passwordRepo.findCurrentPasswordByCompanyId(company.id);
        if (!passwordHash) {
            return null;
        }

        const isValid = await bcrypt.compare(password, passwordHash);
        if (!isValid) {
            return null;
        }

        return jwt.sign({ companyId: company.id }, process.env.JWT_SECRET as string, {
            expiresIn: process.env.JWT_EXPIRATION,
        });
    }

    public async findByTwilioNumber(twilioNumber: string): Promise<CompanyModel> {
        const sanitizedTwilioNumber = twilioNumber.replace(/\s+/g, "");
        const company = await this.companyRepo.findByTwilioNumber(sanitizedTwilioNumber);
        if (!company) {
            throw new Error("Unknown company");
        }
        return company;
    }

    public async setCalendarConnected(companyId: bigint, connected: boolean): Promise<void> {
        await this.companyRepo.setCalendarConnected(companyId, connected);
    }

    public async addInfo(companyId: bigint, value: string): Promise<void> {
        await this.companyRepo.addInfo(companyId, value);
    }

    public async removeInfo(infoId: number): Promise<void> {
        await this.companyRepo.removeInfo(infoId);
    }

    public async getCompanyInfo(companyId: bigint): Promise<CompanyInfoModel[]> {
        return this.companyRepo.fetchInfo(companyId);
    }
}
