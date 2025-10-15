// src/business/services/VoiceSettingsService.ts
import { injectable, inject } from "tsyringe";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../models/VoiceSettingsModel";
import { ReplyStyleModel } from "../models/ReplyStyleModel";
import { AssistantSyncService } from "./AssistantSyncService";

@injectable()
export class VoiceSettingsService {
    constructor(
        @inject("IVoiceRepository") private voiceRepository: IVoiceRepository,
        @inject(AssistantSyncService) private readonly assistantSyncService: AssistantSyncService
    ) {}

    public async getVoiceSettings(companyId: bigint): Promise<VoiceSettingModel | null> {
        try {
            return await this.voiceRepository.fetchVoiceSettings(companyId);
        } catch (err) {
            if (err instanceof Error && err.message.includes("No voice settings")) {
                return null;
            }
            throw err;
        }
    }

    public async updateVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<VoiceSettingModel> {
        await this.voiceRepository.updateVoiceSettings(companyId, settings);
        const refreshed = await this.voiceRepository.fetchVoiceSettings(companyId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return refreshed;
    }

    public async insertVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<VoiceSettingModel> {
        await this.voiceRepository.insertVoiceSettings(companyId, settings);
        const refreshed = await this.voiceRepository.fetchVoiceSettings(companyId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return refreshed;
    }

    public async getReplyStyle(companyId: bigint): Promise<ReplyStyleModel | null> {
        try {
            return await this.voiceRepository.fetchReplyStyle(companyId);
        } catch (err) {
            if (err instanceof Error && err.message.includes("No reply style")) {
                return null;
            }
            throw err;
        }
    }

    public async updateReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<ReplyStyleModel> {
        await this.voiceRepository.updateReplyStyle(companyId, style);
        const refreshed = await this.voiceRepository.fetchReplyStyle(companyId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return refreshed;
    }

    public async insertReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<ReplyStyleModel> {
        await this.voiceRepository.insertReplyStyle(companyId, style);
        const refreshed = await this.voiceRepository.fetchReplyStyle(companyId);
        await this.assistantSyncService.syncCompanyAssistant(companyId);
        return refreshed;
    }
}
