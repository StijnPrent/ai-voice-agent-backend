import axios from "axios";
import { inject, injectable } from "tsyringe";
import { VapiClient, VapiAssistantConfig } from "../../clients/VapiClient";
import { AssistantContextBuilder } from "./AssistantContextBuilder";
import { WhatsappIntegrationService } from "./WhatsappIntegrationService";
import { WhatsappClient } from "../../clients/WhatsappClient";
import {
    IWhatsappConversationRepository,
    WhatsappMessageRecord,
} from "../../data/interfaces/IWhatsappConversationRepository";
import { ProductKnowledgeService } from "./ProductKnowledgeService";

export type WhatsappIncomingMessage = {
    phoneNumberId: string;
    from: string;
    messageId: string;
    text: string;
    profileName?: string | null;
};

type OpenAIMessage = { role: "system" | "assistant" | "user"; content: string };

@injectable()
export class WhatsappChatService {
    private readonly maxMessages = 20;
    private readonly maxChars = 9000;
    private readonly model = process.env.WHATSAPP_CHAT_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

    constructor(
        @inject(WhatsappIntegrationService) private readonly integrationService: WhatsappIntegrationService,
        @inject(AssistantContextBuilder) private readonly contextBuilder: AssistantContextBuilder,
        @inject(VapiClient) private readonly vapiClient: VapiClient,
        @inject("IWhatsappConversationRepository")
        private readonly conversationRepository: IWhatsappConversationRepository,
        @inject(WhatsappClient) private readonly whatsappClient: WhatsappClient,
        @inject(ProductKnowledgeService) private readonly productKnowledgeService: ProductKnowledgeService
    ) {}

    public parseMessages(body: any): WhatsappIncomingMessage[] {
        const entries = Array.isArray(body?.entry) ? body.entry : [];
        const messages: WhatsappIncomingMessage[] = [];

        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            for (const change of changes) {
                const value = change?.value;
                const phoneNumberId = value?.metadata?.phone_number_id;
                const waMessages = Array.isArray(value?.messages) ? value.messages : [];
                for (const msg of waMessages) {
                    if (!msg || msg.type !== "text") {
                        continue;
                    }
                    const textBody = msg?.text?.body;
                    if (typeof textBody !== "string" || !textBody.trim()) {
                        continue;
                    }
                    messages.push({
                        phoneNumberId,
                        from: msg.from,
                        messageId: msg.id,
                        text: textBody.trim(),
                        profileName: value?.contacts?.[0]?.profile?.name,
                    });
                }
            }
        }

        return messages;
    }

    public async handleIncoming(message: WhatsappIncomingMessage): Promise<void> {
        if (!message?.text || !message.phoneNumberId) {
            return;
        }

        const integration = await this.integrationService.getByPhoneNumberId(message.phoneNumberId);
        if (!integration || integration.status === "disabled") {
            console.warn(
                `[WhatsappChatService] No active integration for phoneNumberId=${message.phoneNumberId}`
            );
            return;
        }

        const companyId = integration.companyId;
        const customerNumber = this.sanitizeNumber(message.from);
        const history = await this.conversationRepository.getConversation(companyId, customerNumber);
        const config = await this.contextBuilder.buildConfig(companyId);

        const baseMessages = this.vapiClient.buildContextMessages(config) as OpenAIMessage[];
        const customerContext = this.buildCustomerContext(customerNumber, message.profileName);
        const productContext = await this.buildProductContext(config, message.text, history);

        const chatHistory = this.toChatHistory(history);

        const messages: OpenAIMessage[] = [...baseMessages];
        if (customerContext) messages.push(customerContext);
        if (productContext) messages.push(productContext);
        messages.push(...chatHistory);
        messages.push({ role: "user", content: message.text });

        const assistantReply = await this.generateReply(messages);
        const nextHistory = this.trimConversation([
            ...history,
            { role: "user", content: message.text, timestamp: new Date().toISOString() },
            { role: "assistant", content: assistantReply, timestamp: new Date().toISOString() },
        ]);

        await this.conversationRepository.saveConversation(companyId, customerNumber, nextHistory);

        await this.whatsappClient.sendText({
            phoneNumberId: integration.phoneNumberId,
            to: message.from,
            text: assistantReply,
            accessToken: integration.accessToken,
            replyToMessageId: message.messageId,
        });
    }

    private buildCustomerContext(customerNumber: string, profileName?: string | null): OpenAIMessage | null {
        const parts = [`Contactnummer: ${customerNumber}`];
        if (profileName?.trim()) {
            parts.push(`WhatsApp naam: ${profileName.trim()}`);
        }
        return {
            role: "system",
            content: `Chat-metadata\n${parts.join("\n")}`,
        };
    }

    private async buildProductContext(
        config: VapiAssistantConfig,
        userMessage: string,
        history: WhatsappMessageRecord[]
    ): Promise<OpenAIMessage | null> {
        if (!config.productCatalog?.length) {
            return null;
        }

        const haystack = [userMessage, ...history.slice(-4).map((m) => m.content)]
            .join(" ")
            .toLowerCase();

        const matches = config.productCatalog
            .filter((product) => {
                const name = product.name?.toLowerCase?.() ?? "";
                const sku = product.sku?.toLowerCase?.() ?? "";
                const synonyms = (product.synonyms ?? []).map((syn) => syn.toLowerCase());
                return (
                    (name && haystack.includes(name)) ||
                    (sku && haystack.includes(sku)) ||
                    synonyms.some((syn) => syn && haystack.includes(syn))
                );
            })
            .slice(0, 3);

        const selected =
            matches.length > 0
                ? matches
                : config.productCatalog.slice(0, Math.min(2, config.productCatalog.length));
        if (selected.length === 0) {
            return null;
        }

        const details = await Promise.all(
            selected.map(async (product) => {
                try {
                    const id = Number(product.id);
                    const full = await this.productKnowledgeService.getProduct(config.company.id, id);
                    return { product, full };
                } catch {
                    return { product, full: null };
                }
            })
        );

        const lines = details
            .map(({ product, full }) => {
                const summaryParts: string[] = [];
                if (full?.content?.description) {
                    summaryParts.push(`Beschrijving: ${this.limit(full.content.description, 400)}`);
                } else if (product.summary) {
                    summaryParts.push(`Samenvatting: ${this.limit(product.summary, 300)}`);
                }

                if (Array.isArray(full?.content?.faq) && full.content.faq.length > 0) {
                    const faq = full.content.faq
                        .slice(0, 3)
                        .map((f) => `Q: ${this.limit(f.question, 120)} | A: ${this.limit(f.answer, 180)}`);
                    summaryParts.push(`FAQ: ${faq.join(" || ")}`);
                }

                if (Array.isArray(full?.content?.policies) && full.content.policies.length > 0) {
                    const policy = full.content.policies
                        .slice(0, 2)
                        .map((p) => `${p.title ?? "Policy"}: ${this.limit(p.content, 160)}`);
                    summaryParts.push(`Policies: ${policy.join(" | ")}`);
                }

                if (!summaryParts.length) {
                    return null;
                }

                return `#${product.id} ${product.name}\n${summaryParts.join("\n")}`;
            })
            .filter((line): line is string => Boolean(line));

        if (lines.length === 0) {
            return null;
        }

        return {
            role: "system",
            content: `Relevante productkennis:\n${lines.join("\n\n")}\nGebruik deze info om vragen te beantwoorden in plaats van te hallucinatederen.`,
        };
    }

    private toChatHistory(history: WhatsappMessageRecord[]): OpenAIMessage[] {
        return history
            .slice(-this.maxMessages)
            .map((m) => ({
                role: m.role,
                content: m.content,
            }))
            .filter((m) => m.content.trim().length > 0) as OpenAIMessage[];
    }

    private trimConversation(messages: WhatsappMessageRecord[]): WhatsappMessageRecord[] {
        const trimmed = messages.slice(-this.maxMessages);
        let total = 0;
        const result: WhatsappMessageRecord[] = [];

        for (let i = trimmed.length - 1; i >= 0; i--) {
            const current = trimmed[i];
            const length = current.content.length;
            if (total + length > this.maxChars) {
                continue;
            }
            total += length;
            result.unshift(current);
        }

        return result;
    }

    private sanitizeNumber(raw: string): string {
        return raw.replace(/[^\d+]/g, "");
    }

    private limit(value: string | null | undefined, max = 320): string {
        if (!value) return "";
        const trimmed = value.trim();
        if (trimmed.length <= max) return trimmed;
        return `${trimmed.slice(0, max - 3)}...`;
    }

    private async generateReply(messages: OpenAIMessage[]): Promise<string> {
        const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY;
        if (!apiKey) {
            console.warn("[WhatsappChatService] Missing OPENAI_API_KEY");
            return "Er ging iets mis aan onze kant. Probeer het zo nog eens.";
        }

        try {
            const response = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: this.model,
                    messages,
                    temperature: 0.4,
                    max_tokens: 400,
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 12000,
                }
            );

            const content = response.data?.choices?.[0]?.message?.content;
            if (typeof content === "string" && content.trim()) {
                return content.trim();
            }

            return "Ik heb je bericht ontvangen. Kun je het iets anders formuleren?";
        } catch (error) {
            console.error("[WhatsappChatService] Failed to generate reply", error);
            return "Ik kan nu even niet antwoorden. Probeer het later opnieuw.";
        }
    }
}
