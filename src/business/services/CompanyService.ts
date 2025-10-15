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
import { AssistantSyncService } from "./AssistantSyncService";
import { InvalidAccessCodeError } from "../errors/InvalidAccessCodeError";

@injectable()
export class CompanyService {
    constructor(
        @inject("ICompanyRepository") private companyRepo: ICompanyRepository,
        @inject("IPasswordRepository") private passwordRepo: IPasswordRepository,
        @inject(AssistantSyncService) private readonly assistantSyncService: AssistantSyncService
    ) {}

    private getAllowedAccessCodes(): string[] {
        const envCodes =
            process.env.COMPANY_ACCESS_CODES ?? process.env.COMPANY_ACCESS_CODE ?? "";

        return envCodes
            .split(/[,\s]+/)
            .map((code) => code.trim())
            .filter((code) => code.length > 0);
    }

    private async ensureValidAccessCode(accessCode?: string): Promise<void> {
        const allowedCodes = this.getAllowedAccessCodes();
        if (allowedCodes.length === 0) {
            return;
        }

        const normalized = (accessCode ?? "").trim();
        if (!normalized || !allowedCodes.includes(normalized)) {
            throw new InvalidAccessCodeError();
        }
    }

    public async registerCompany(params: {
        companyName: string;
        contactName?: string;
        email: string;
        password: string;
        accessCode?: string;
    }): Promise<CompanyModel> {
        await this.ensureValidAccessCode(params.accessCode);

        const company = await this.create(
            params.companyName,
            params.email,
            "",
            params.password
        );

        // Optionally seed initial details/contact information with provided data.
        if (params.companyName?.trim()) {
            await this.saveCompanyDetails(company.id, {
                name: params.companyName.trim(),
            });
        }

        return company;
    }

    // Create and authenticate companies
    public async create(
        name: string,
        email: string,
        twilioNumber: string = "",
        password: string
    ): Promise<CompanyModel> {
        const bytes = crypto.randomBytes(8);
        const sanitizedTwilio = (twilioNumber ?? "").replace(/\s+/g, "");
        const id = BigInt("0x" + bytes.toString("hex"));

        const company = new CompanyModel(
            id,
            name,
            email,
            sanitizedTwilio,
            new Date(),
            new Date(),
            null
        );
        await this.companyRepo.createCompany(company);

        const hash = await bcrypt.hash(password, 10);
        await this.passwordRepo.createPassword(id, hash);
        return company;
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
    public async addInfo(companyId: bigint, value: string): Promise<CompanyInfoModel> {
        const info = await this.companyRepo.addInfo(companyId, value);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return info;
    }

    public async getCompanyInfo(companyId: bigint): Promise<CompanyInfoModel[]> {
        return this.companyRepo.fetchInfo(companyId);
    }

    public async updateInfo(id: number, value: string): Promise<CompanyInfoModel> {
        const info = new CompanyInfoModel(id, value, new Date());
        const updated = await this.companyRepo.updateInfo(info);
        const companyId = await this.companyRepo.getCompanyIdForInfo(id);
        if (companyId) {
            await this.assistantSyncService.syncCompanyAssistant(companyId);
        }
        return updated;
    }

    public async removeInfo(infoId: number): Promise<void> {
        const companyId = await this.companyRepo.getCompanyIdForInfo(infoId);
        await this.companyRepo.removeInfo(infoId);
        if (companyId) {
            await this.assistantSyncService.syncCompanyAssistant(companyId);
        }
    }

    // Company Details
    public async getCompanyDetails(
        companyId: bigint
    ): Promise<CompanyDetailsModel | null> {
        return this.companyRepo.fetchCompanyDetails(companyId);
    }

    public async saveCompanyDetails(
        companyId: bigint,
        payload: {
            name?: string;
            industry?: string;
            size?: string;
            foundedYear?: number;
            description?: string;
        }
    ): Promise<CompanyDetailsModel> {
        const existing = await this.companyRepo.fetchCompanyDetails(companyId);
        const details = new CompanyDetailsModel(
            existing?.id ?? 0,
            companyId,
            payload.name ?? existing?.name ?? "",
            payload.industry ?? existing?.industry ?? "",
            payload.size ?? existing?.size ?? "",
            payload.foundedYear ?? existing?.foundedYear ?? 0,
            payload.description ?? existing?.description ?? ""
        );

        const saved = existing
            ? await this.companyRepo.updateCompanyDetails(details)
            : await this.companyRepo.addCompanyDetails(details);

        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return saved;
    }

    public async deleteCompanyDetails(detailsId: number): Promise<void> {
        const companyId = await this.companyRepo.getCompanyIdForDetails(detailsId);
        await this.companyRepo.deleteCompanyDetails(detailsId);
        if (companyId) {
            await this.assistantSyncService.syncCompanyAssistant(companyId);
        }
    }

    // Company Contact
    public async getCompanyContact(
        companyId: bigint
    ): Promise<CompanyContactModel | null> {
        return this.companyRepo.fetchCompanyContact(companyId);
    }

    public async saveCompanyContact(
        companyId: bigint,
        payload: {
            website?: string;
            phone?: string;
            email?: string;
            contact_email?: string;
            address?: string;
        }
    ): Promise<CompanyContactModel> {
        const existing = await this.companyRepo.fetchCompanyContact(companyId);
        const contact = new CompanyContactModel(
            existing?.id ?? 0,
            companyId,
            payload.website ?? existing?.website ?? "",
            payload.phone ?? existing?.phone ?? "",
            payload.contact_email ?? payload.email ?? existing?.contact_email ?? "",
            payload.address ?? existing?.address ?? ""
        );

        if (existing) {
            await this.companyRepo.updateCompanyContact(contact);
        } else {
            await this.companyRepo.addCompanyContact(contact);
        }

        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return (await this.companyRepo.fetchCompanyContact(companyId)) ?? contact;
    }

    public async deleteCompanyContact(contactId: number): Promise<void> {
        const companyId = await this.companyRepo.getCompanyIdForContact(contactId);
        await this.companyRepo.deleteCompanyContact(contactId);
        if (companyId) {
            await this.assistantSyncService.syncCompanyAssistant(companyId);
        }
    }

    // Company Hours
    public async addCompanyHour(
        companyId: bigint,
        dayOfWeek: number,
        isOpen: boolean,
        openTime: string | null,
        closeTime: string | null
    ): Promise<CompanyHourModel> {
        const existing = await this.companyRepo.findCompanyHourByDay(companyId, dayOfWeek);
        const hour = new CompanyHourModel(
            existing?.id ?? 0,
            companyId,
            dayOfWeek,
            isOpen,
            openTime,
            closeTime
        );
        const saved = existing
            ? await this.companyRepo.updateCompanyHour(hour)
            : await this.companyRepo.addCompanyHour(hour);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return saved;
    }

    public async getCompanyHours(
        companyId: bigint
    ): Promise<CompanyHourModel[]> {
        return this.companyRepo.fetchCompanyHours(companyId);
    }

    public async updateCompanyHour(
        hour: CompanyHourModel
    ): Promise<CompanyHourModel> {
        const saved = await this.companyRepo.updateCompanyHour(hour);
        await this.assistantSyncService.syncCompanyAssistant(hour.companyId);
        return saved;
    }

    public async deleteCompanyHour(hourId: number): Promise<void> {
        const companyId = await this.companyRepo.getCompanyIdForHour(hourId);
        await this.companyRepo.deleteCompanyHour(hourId);
        if (companyId) {
            await this.assistantSyncService.syncCompanyAssistant(companyId);
        }
    }

    public async getCompanyContext(companyId: bigint) {
        const details = await this.getCompanyDetails(companyId);
        const contact = await this.getCompanyContact(companyId);
        const hours = await this.getCompanyHours(companyId);
        const info = await this.getCompanyInfo(companyId);

        return {
            details,
            contact,
            hours,
            info,
        };
    }
}
