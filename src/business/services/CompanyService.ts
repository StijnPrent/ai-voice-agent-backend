import { injectable, inject } from "tsyringe";
import { ICompanyRepository } from "../../data/interfaces/ICompanyRepository";
import { IPasswordRepository } from "../../data/interfaces/IPasswordRepository";
import { CompanyModel } from "../models/CompanyModel";
import { CompanyInfoModel } from "../models/CompanyInfoModel";
import { CompanyDetailsModel } from "../models/CompanyDetailsModel";
import { CompanyContactModel } from "../models/CompanyContactModel";
import { CompanyHourModel } from "../models/CompanyHourModel";
import { CompanyCallerModel } from "../models/CompanyCallerModel";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AssistantSyncService } from "./AssistantSyncService";
import { InvalidAccessCodeError } from "../errors/InvalidAccessCodeError";
import { TransactionalMailService } from "./TransactionalMailService";
import { IAuthTokenRepository, AuthTokenType } from "../../data/interfaces/IAuthTokenRepository";
import { EmailNotVerifiedError } from "../errors/EmailNotVerifiedError";
import config from "../../config/config";

@injectable()
export class CompanyService {
    constructor(
        @inject("ICompanyRepository") private companyRepo: ICompanyRepository,
        @inject("IPasswordRepository") private passwordRepo: IPasswordRepository,
        @inject("IAuthTokenRepository") private readonly authTokenRepository: IAuthTokenRepository,
        private readonly transactionalMail: TransactionalMailService,
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

    private tryNormalizeCallerPhoneNumber(raw: string | null | undefined): string | null {
        if (typeof raw !== "string") {
            return null;
        }
        const trimmed = raw.trim();
        if (!trimmed) {
            return null;
        }
        const compact = trimmed.replace(/\s+/g, "");
        return compact.length > 0 ? compact : null;
    }

    private normalizeCallerPhoneNumber(raw: string | null | undefined): string {
        const normalized = this.tryNormalizeCallerPhoneNumber(raw);
        if (!normalized) {
            throw new Error("A valid phoneNumber is required.");
        }
        return normalized;
    }

    private buildFrontendLink(path: string): string {
        const base = (config.frontendUrl || "").replace(/\/+$/, "");
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        return base ? `${base}${normalizedPath}` : normalizedPath;
    }

    private buildBackendLink(path: string): string {
        const base = (config.serverUrl || "").replace(/\/+$/, "");
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        return base ? `${base}${normalizedPath}` : normalizedPath;
    }

    private hashToken(token: string): string {
        return crypto.createHash("sha256").update(token).digest("hex");
    }

    private async issueAuthToken(
        companyId: bigint,
        type: AuthTokenType,
        expiresInMinutes: number,
        metadata?: Record<string, any> | null
    ): Promise<string> {
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = this.hashToken(rawToken);
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
        await this.authTokenRepository.invalidateTokens(companyId, type);
        await this.authTokenRepository.createToken({
            companyId,
            tokenHash,
            type,
            expiresAt,
            metadata: metadata ?? null,
        });
        return rawToken;
    }

    private async sendVerificationEmail(company: CompanyModel, context?: { companyName?: string; contactName?: string }) {
        const token = await this.issueAuthToken(company.id, "email-verification", 60 * 24, {
            email: company.email,
        });
        const verificationUrl = this.buildBackendLink(`/email/verification/confirm?token=${encodeURIComponent(token)}`);
        await this.transactionalMail.sendEmailVerification({
            to: company.email,
            companyName: context?.companyName ?? company.name,
            contactName: context?.contactName ?? company.name ?? company.email,
            verificationUrl,
        });
    }

    private async sendPasswordResetEmail(company: CompanyModel): Promise<void> {
        const token = await this.issueAuthToken(company.id, "password-reset", 60, {
            email: company.email,
        });
        const resetUrl = this.buildFrontendLink(`/reset-password?token=${token}`);
        await this.transactionalMail.sendPasswordReset({
            to: company.email,
            resetUrl,
            companyName: company.name,
        });
    }

    public async registerCompany(params: {
        companyName: string;
        contactName?: string;
        email: string;
        password: string;
        accessCode?: string;
        useType?: string | null;
    }): Promise<CompanyModel> {
        await this.ensureValidAccessCode(params.accessCode);

        const company = await this.create(
            params.companyName,
            params.email,
            "",
            params.password,
            params.useType ?? null
        );

        // Optionally seed initial details/contact information with provided data.
        if (params.companyName?.trim()) {
            await this.saveCompanyDetails(company.id, {
                name: params.companyName.trim(),
            });
        }

        await this.sendVerificationEmail(company, {
            companyName: params.companyName,
            contactName: params.contactName,
        });

        return company;
    }

    // Create and authenticate companies
    public async create(
        name: string,
        email: string,
        twilioNumber: string = "",
        password: string,
        useType: string | null = null
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
            null,
            true,
            null,
            useType ?? null
        );
        await this.companyRepo.createCompany(company);

        const hash = await bcrypt.hash(password, 10);
        await this.passwordRepo.createPassword(id, hash);
        return company;
    }

    public async login(email: string, password: string): Promise<{ token: string; useType: string | null } | null> {
        const company = await this.companyRepo.findByEmail(email);
        if (!company) return null;

        const storedHash = await this.passwordRepo.findCurrentPasswordByCompanyId(
            company.id
        );
        if (!storedHash) return null;

        const valid = await bcrypt.compare(password, storedHash);
        if (!valid) return null;

        if (!company.emailVerifiedAt) {
            throw new EmailNotVerifiedError();
        }

        const token = jwt.sign(
            { companyId: company.id.toString(), useType: company.useType ?? null },
            process.env.JWT_SECRET!,
            { expiresIn: "8h" }
        );
        return { token, useType: company.useType ?? null };
    }

    public async resendVerificationEmail(email: string): Promise<void> {
        const company = await this.companyRepo.findByEmail(email);
        if (!company) {
            return;
        }
        if (company.emailVerifiedAt) {
            return;
        }
        await this.sendVerificationEmail(company, {
            companyName: company.name,
        });
    }

    public async sendVerificationForCompany(companyId: bigint): Promise<void> {
        const company = await this.companyRepo.findById(companyId);
        if (!company) {
            throw new Error("Company not found");
        }
        await this.sendVerificationEmail(company, {
            companyName: company.name,
        });
    }

    public async confirmEmailVerification(token: string): Promise<void> {
        if (!token?.trim()) {
            throw new Error("Verificatietoken ontbreekt.");
        }
        const tokenHash = this.hashToken(token.trim());
        const record = await this.authTokenRepository.findValidToken("email-verification", tokenHash);
        if (!record) {
            throw new Error("Deze verificatielink is verlopen of ongeldig.");
        }

        await this.companyRepo.markEmailVerified(record.companyId);
        await this.authTokenRepository.markConsumed(record.id);
    }

    public async requestPasswordReset(email: string): Promise<void> {
        const company = await this.companyRepo.findByEmail(email);
        if (!company || !company.emailVerifiedAt) {
            return;
        }
        await this.sendPasswordResetEmail(company);
    }

    public async resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
        if (!token?.trim()) {
            throw new Error("Reset token ontbreekt.");
        }
        if (!newPassword || newPassword.length < 8) {
            throw new Error("Het wachtwoord moet minimaal 8 tekens lang zijn.");
        }

        const tokenHash = this.hashToken(token.trim());
        const record = await this.authTokenRepository.findValidToken("password-reset", tokenHash);
        if (!record) {
            throw new Error("Deze resetlink is verlopen of ongeldig.");
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await this.passwordRepo.createPassword(record.companyId, hash);
        await this.authTokenRepository.markConsumed(record.id);
    }

    public async findById(companyId: bigint): Promise<CompanyModel> {
        const company = await this.companyRepo.findById(companyId);
        if (!company) {
            throw new Error("Company not found");
        }
        return company;
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

    public async setAssistantEnabled(companyId: bigint, enabled: boolean): Promise<void> {
        await this.companyRepo.setAssistantEnabled(companyId, enabled);
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

    // Company Callers
    public async listCompanyCallers(companyId: bigint): Promise<CompanyCallerModel[]> {
        return this.companyRepo.fetchCompanyCallers(companyId);
    }

    public async createCompanyCaller(
        companyId: bigint,
        payload: { name?: string; phoneNumber?: string }
    ): Promise<CompanyCallerModel> {
        const name = (payload.name ?? "").trim();
        if (!name) {
            throw new Error("Caller name is required.");
        }
        const phoneNumber = this.normalizeCallerPhoneNumber(payload.phoneNumber);

        const existing = await this.companyRepo.findCompanyCallerByPhone(companyId, phoneNumber);
        const model = new CompanyCallerModel(existing?.id ?? 0, companyId, name, phoneNumber);

        const saved = existing
            ? await this.companyRepo.updateCompanyCaller(model)
            : await this.companyRepo.addCompanyCaller(model);

        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return saved;
    }

    public async updateCompanyCaller(
        companyId: bigint,
        callerId: number,
        payload: { name?: string; phoneNumber?: string }
    ): Promise<CompanyCallerModel> {
        const existing = await this.companyRepo.findCompanyCallerById(callerId);
        if (!existing || existing.companyId !== companyId) {
            throw new Error("Caller not found.");
        }

        const nextName = (payload.name ?? existing.name).trim();
        if (!nextName) {
            throw new Error("Caller name is required.");
        }
        const nextPhone = payload.phoneNumber
            ? this.normalizeCallerPhoneNumber(payload.phoneNumber)
            : existing.phoneNumber;

        const collision = await this.companyRepo.findCompanyCallerByPhone(companyId, nextPhone);
        if (collision && collision.id !== callerId) {
            throw new Error("Another caller already uses this phone number.");
        }

        const updated = await this.companyRepo.updateCompanyCaller(
            new CompanyCallerModel(existing.id, companyId, nextName, nextPhone)
        );

        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return updated;
    }

    public async deleteCompanyCaller(companyId: bigint, callerId: number): Promise<void> {
        const ownerCompanyId = await this.companyRepo.getCompanyIdForCaller(callerId);
        if (!ownerCompanyId || ownerCompanyId !== companyId) {
            throw new Error("Caller not found.");
        }

        await this.companyRepo.deleteCompanyCaller(callerId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
    }

    public async resolveCallerName(companyId: bigint, phoneNumber: string | null | undefined): Promise<string | null> {
        const normalized = this.tryNormalizeCallerPhoneNumber(phoneNumber);
        if (!normalized) {
            return null;
        }
        const caller = await this.companyRepo.findCompanyCallerByPhone(companyId, normalized);
        return caller?.name ?? null;
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
        const callers = await this.listCompanyCallers(companyId);

        return {
            details,
            contact,
            hours,
            info,
            callers,
        };
    }
}
