export type WhatsappIntegrationRecord = {
    companyId: bigint;
    businessAccountId: string;
    phoneNumberId: string;
    accessToken: string;
    verifyToken: string | null;
    status: "active" | "disabled";
    createdAt?: Date | null;
    updatedAt?: Date | null;
};

export type UpsertWhatsappIntegrationInput = {
    companyId: bigint;
    businessAccountId: string;
    phoneNumberId: string;
    accessToken: string;
    verifyToken?: string | null;
    status?: "active" | "disabled";
};

export interface IWhatsappIntegrationRepository {
    upsert(input: UpsertWhatsappIntegrationInput): Promise<void>;
    findByCompanyId(companyId: bigint): Promise<WhatsappIntegrationRecord | null>;
    findByPhoneNumberId(phoneNumberId: string): Promise<WhatsappIntegrationRecord | null>;
}
