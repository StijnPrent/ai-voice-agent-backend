// src/business/services/AssistantSyncService.ts
import { inject, injectable } from "tsyringe";
import { VapiAssistantConfig, VapiClient } from "../../clients/VapiClient";
import { ICompanyRepository } from "../../data/interfaces/ICompanyRepository";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { ISchedulingRepository } from "../../data/interfaces/ISchedulingRepository";
import { IntegrationService } from "./IntegrationService";

@injectable()
export class AssistantSyncService {
    constructor(
        @inject(VapiClient) private readonly vapiClient: VapiClient,
        @inject("ICompanyRepository") private readonly companyRepository: ICompanyRepository,
        @inject("IVoiceRepository") private readonly voiceRepository: IVoiceRepository,
        @inject("ISchedulingRepository") private readonly schedulingRepository: ISchedulingRepository,
        @inject(IntegrationService) private readonly integrationService: IntegrationService
    ) {}

    public async syncCompanyAssistant(companyId: bigint): Promise<void> {
        try {
            const config = await this.buildConfig(companyId);
            if (!config) {
                console.warn(`[AssistantSyncService] Skipping sync for ${companyId}: missing configuration.`);
                return;
            }
            await this.vapiClient.syncAssistant(config);
        } catch (error) {
            console.error(`[AssistantSyncService] Failed to sync assistant for company ${companyId}`, error);
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

        const [details, contact, hours, info] = await Promise.all([
            this.companyRepository.fetchCompanyDetails(companyId),
            this.companyRepository.fetchCompanyContact(companyId),
            this.companyRepository.fetchCompanyHours(companyId),
            this.companyRepository.fetchInfo(companyId),
        ]);

        const [appointmentTypes, staffMembers, hasGoogleIntegration] = await Promise.all([
            this.schedulingRepository.fetchAppointmentTypes(companyId),
            this.schedulingRepository.fetchStaffMembers(companyId),
            this.integrationService.hasCalendarConnected(companyId),
        ]);

        return {
            company,
            hasGoogleIntegration,
            replyStyle,
            companyContext: {
                details,
                contact,
                hours,
                info,
            },
            schedulingContext: {
                appointmentTypes,
                staffMembers,
            },
            voiceSettings,
        };
    }
}
