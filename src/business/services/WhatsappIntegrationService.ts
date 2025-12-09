import { inject, injectable } from "tsyringe";
import {
    IWhatsappIntegrationRepository,
    UpsertWhatsappIntegrationInput,
    WhatsappIntegrationRecord,
} from "../../data/interfaces/IWhatsappIntegrationRepository";

@injectable()
export class WhatsappIntegrationService {
    constructor(
        @inject("IWhatsappIntegrationRepository")
        private readonly repository: IWhatsappIntegrationRepository
    ) {}

    public async upsertIntegration(input: UpsertWhatsappIntegrationInput): Promise<void> {
        const sanitized = {
            ...input,
            businessAccountId: input.businessAccountId.trim(),
            phoneNumberId: input.phoneNumberId.trim(),
            accessToken: input.accessToken.trim(),
            verifyToken: input.verifyToken?.trim() || null,
            status: input.status ?? "active",
        };

        await this.repository.upsert(sanitized);
    }

    public async getByCompanyId(companyId: bigint): Promise<WhatsappIntegrationRecord | null> {
        return this.repository.findByCompanyId(companyId);
    }

    public async getByPhoneNumberId(phoneNumberId: string): Promise<WhatsappIntegrationRecord | null> {
        return this.repository.findByPhoneNumberId(phoneNumberId.trim());
    }

    public isValidVerifyToken(token: string | undefined | null): boolean {
        if (!token) return false;
        const normalized = token.trim();
        const expected = (process.env.WHATSAPP_VERIFY_TOKEN || "").trim();
        return Boolean(expected && normalized && normalized === expected);
    }
}
