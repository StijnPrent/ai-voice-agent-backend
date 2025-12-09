import { inject, injectable } from "tsyringe";
import { VapiAssistantConfig } from "../../clients/VapiClient";
import { CompanyService } from "./CompanyService";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { SchedulingService } from "./SchedulingService";
import { IntegrationService } from "./IntegrationService";
import { ProductKnowledgeService } from "./ProductKnowledgeService";

@injectable()
export class AssistantContextBuilder {
    constructor(
        @inject(CompanyService) private readonly companyService: CompanyService,
        @inject("IVoiceRepository") private readonly voiceRepository: IVoiceRepository,
        @inject(SchedulingService) private readonly schedulingService: SchedulingService,
        @inject(IntegrationService) private readonly integrationService: IntegrationService,
        @inject(ProductKnowledgeService) private readonly productKnowledgeService: ProductKnowledgeService
    ) {}

    /**
     * Builds the full Vapi assistant config used by both voice and chat channels so they share knowledge.
     */
    public async buildConfig(companyId: bigint): Promise<VapiAssistantConfig> {
        const company = await this.companyService.findById(companyId);

        const [companyContext, replyStyle, voiceSettings, schedulingContext, calendarStatus] = await Promise.all([
            this.companyService.getCompanyContext(companyId),
            this.voiceRepository.fetchReplyStyle(companyId),
            this.voiceRepository.fetchVoiceSettings(companyId),
            this.schedulingService.getSchedulingContext(companyId),
            this.integrationService.getCalendarIntegrationStatus(companyId),
        ]);

        const [hasGoogleIntegration, calendarProvider] = [
            this.integrationService.isCalendarConnected(calendarStatus),
            this.integrationService.pickCalendarProvider(calendarStatus),
        ];

        let productCatalog: VapiAssistantConfig["productCatalog"] = [];
        try {
            const products = await this.productKnowledgeService.listCatalog(companyId, "published");
            productCatalog = products.map((product) => ({
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
            console.error(`[AssistantContextBuilder] Failed to load product catalog for company ${companyId.toString()}`, error);
        }

        return {
            company,
            hasGoogleIntegration,
            calendarProvider,
            replyStyle,
            companyContext,
            schedulingContext,
            productCatalog,
            voiceSettings,
        };
    }
}
