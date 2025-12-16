// src/business/services/AssistantSyncService.ts
import axios from "axios";
import { inject, injectable, delay } from "tsyringe";
import { VapiAssistantConfig, VapiClient } from "../../clients/VapiClient";
import { ICompanyRepository } from "../../data/interfaces/ICompanyRepository";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { ISchedulingRepository } from "../../data/interfaces/ISchedulingRepository";
import { IntegrationService } from "./IntegrationService";
import { AssistantSyncError } from "../errors/AssistantSyncError";
import { CustomInstructionService } from "./CustomInstructionService";
import { IProductKnowledgeRepository } from "../../data/interfaces/IProductKnowledgeRepository";

@injectable()
export class AssistantSyncService {
    private readonly debounceMs = 800;
    private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
    private readonly pendingPromises = new Map<string, Promise<void>>();

    constructor(
        @inject(delay(() => VapiClient)) private readonly vapiClient: VapiClient,
        @inject("ICompanyRepository") private readonly companyRepository: ICompanyRepository,
        @inject("IVoiceRepository") private readonly voiceRepository: IVoiceRepository,
        @inject("ISchedulingRepository") private readonly schedulingRepository: ISchedulingRepository,
        @inject(IntegrationService) private readonly integrationService: IntegrationService,
        @inject(CustomInstructionService) private readonly customInstructionService: CustomInstructionService,
        @inject("IProductKnowledgeRepository") private readonly productKnowledgeRepository: IProductKnowledgeRepository
    ) {}

    public async syncCompanyAssistant(companyId: bigint): Promise<void> {
        const key = companyId.toString();

        // Coalesce rapid-fire calls per company into a single sync.
        const existing = this.pendingPromises.get(key);
        if (existing) {
            return existing;
        }

        const promise = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(async () => {
                this.pendingTimers.delete(key);
                try {
                    await this.performSync(companyId);
                    this.pendingPromises.delete(key);
                    resolve();
                } catch (error) {
                    this.pendingPromises.delete(key);
                    reject(error);
                }
            }, this.debounceMs);

            this.pendingTimers.set(key, timer);
        });

        this.pendingPromises.set(key, promise);
        return promise;
    }

    private async performSync(companyId: bigint): Promise<void> {
        try {
            const config = await this.buildConfig(companyId);
            if (!config) {
                console.warn(`[AssistantSyncService] Skipping sync for ${companyId}: missing configuration.`);
                return;
            }
            const existingAssistantId = config.company.assistantId;

            if (!existingAssistantId) {
                const createdId = await this.vapiClient.createAssistantWithConfig(config);
                await this.companyRepository.saveAssistantId(companyId, createdId);
                return;
            }

            try {
                await this.vapiClient.updateAssistantWithConfig(existingAssistantId, config);
            } catch (error) {
                if (axios.isAxiosError(error) && error.response?.status === 404) {
                    console.warn(
                        `[AssistantSyncService] Assistant ${existingAssistantId} not found for company ${companyId}; recreating.`
                    );
                    const recreatedId = await this.vapiClient.createAssistantWithConfig(config);
                    await this.companyRepository.saveAssistantId(companyId, recreatedId);
                    return;
                }

                throw error;
            }
        } catch (error) {
            console.error(`[AssistantSyncService] Failed to sync assistant for company ${companyId}`, error);
            const details = this.extractAssistantSyncErrorDetails(error);
            if (details) {
                throw new AssistantSyncError(details.messages, details.statusCode);
            }

            throw error;
        }
    }

    private async buildConfig(companyId: bigint): Promise<VapiAssistantConfig | null> {
        const company = await this.companyRepository.findById(companyId);
        if (!company) {
            console.warn(`[AssistantSyncService] Company ${companyId} not found when preparing Vapi config.`);
            return null;
        }

        let voiceSettings;
        let replyStyle;
        try {
            voiceSettings = await this.voiceRepository.fetchVoiceSettings(companyId);
            replyStyle = await this.voiceRepository.fetchReplyStyle(companyId);
        } catch (error) {
            console.warn(
                `[AssistantSyncService] Missing voice settings or reply style for company ${companyId}; deferring assistant sync.`
            );
            return null;
        }

        const [details, contact, hours, info, callers] = await Promise.all([
            this.companyRepository.fetchCompanyDetails(companyId),
            this.companyRepository.fetchCompanyContact(companyId),
            this.companyRepository.fetchCompanyHours(companyId),
            this.companyRepository.fetchInfo(companyId),
            this.companyRepository.fetchCompanyCallers(companyId),
        ]);

        const [appointmentTypes, staffMembers, calendarStatus, commerce, customInstructions, productCatalog] =
            await Promise.all([
            this.schedulingRepository.fetchAppointmentTypes(companyId),
            this.schedulingRepository.fetchStaffMembers(companyId),
            this.integrationService.getCalendarIntegrationStatus(companyId),
            this.integrationService.getCommerceConnections(companyId),
            this.customInstructionService.list(companyId),
            this.loadProductCatalog(companyId),
        ]);
        const calendarProvider = this.integrationService.pickCalendarProvider(calendarStatus);
        const hasGoogleIntegration = this.integrationService.isCalendarConnected(calendarStatus);
        const commerceStores: Array<"shopify" | "woocommerce"> = [];
        if (commerce.shopify) commerceStores.push("shopify");
        if (commerce.woocommerce) commerceStores.push("woocommerce");
        console.log(
            `[AssistantSyncService] commerce connections for ${companyId.toString()}:`,
            commerceStores.length ? commerceStores.join(",") : "none"
        );

        return {
            company,
            hasGoogleIntegration,
            calendarProvider,
            commerceStores,
            replyStyle,
            companyContext: {
                details,
                contact,
                hours,
                info,
                callers,
            },
            schedulingContext: {
                appointmentTypes,
                staffMembers,
            },
            productCatalog,
            voiceSettings,
            customInstructions: customInstructions.map((i) => i.instruction),
        };
    }

    private async loadProductCatalog(companyId: bigint) {
        try {
            const products = await this.productKnowledgeRepository.listByCompany(companyId, "published");
            return products.map((product) => ({
                id: product.id.toString(),
                name: product.name,
                sku: product.sku,
                summary: product.summary ?? product.content.summary ?? null,
                synonyms: product.synonyms,
                status: product.status,
                version: product.version,
                updatedAt: product.updatedAt.toISOString(),
            }));
        } catch (error) {
            console.error(
                `[AssistantSyncService] Failed to load product catalog for company ${companyId.toString()}`,
                error
            );
            return [];
        }
    }

    private extractAssistantSyncErrorDetails(error: unknown): { messages: string[]; statusCode: number } | null {
        if (!axios.isAxiosError(error)) {
            return null;
        }

        const responseData: any = error.response?.data;
        const statusCode = error.response?.status ?? responseData?.statusCode ?? 500;

        const collected: string[] = [];
        const pushValue = (value: unknown) => {
            if (value === null || value === undefined) return;
            if (Array.isArray(value)) {
                value.forEach(pushValue);
                return;
            }
            if (typeof value === "string") {
                collected.push(value);
                return;
            }
            if (typeof value === "number" || typeof value === "boolean") {
                collected.push(String(value));
            }
        };

        pushValue(responseData?.message ?? responseData?.messages);

        if (collected.length === 0) {
            pushValue(responseData?.error);
        }

        if (collected.length === 0 && typeof responseData === "string") {
            collected.push(responseData);
        }

        if (collected.length === 0 && typeof error.message === "string") {
            collected.push(error.message);
        }

        if (collected.length === 0) {
            return {
                messages: ["Failed to sync assistant"],
                statusCode,
            };
        }

        return {
            messages: collected,
            statusCode,
        };
    }
}
