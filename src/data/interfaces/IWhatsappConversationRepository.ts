export type WhatsappMessageRecord = {
    role: "user" | "assistant";
    content: string;
    timestamp: string;
};

export interface IWhatsappConversationRepository {
    getConversation(companyId: bigint, customerNumber: string): Promise<WhatsappMessageRecord[]>;
    saveConversation(companyId: bigint, customerNumber: string, messages: WhatsappMessageRecord[]): Promise<void>;
    clearConversation(companyId: bigint, customerNumber: string): Promise<void>;
}
