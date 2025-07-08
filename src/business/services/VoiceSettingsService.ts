// src/business/services/VoiceSettingsService.ts
import { injectable, inject } from "tsyringe";
import { IVoiceRepository } from "../../data/interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../models/VoiceSettingsModel";
import { ReplyStyleModel } from "../models/ReplyStyleModel";

@injectable()
export class VoiceSettingsService {
    constructor(
        @inject("IVoiceRepository") private voiceRepository: IVoiceRepository
    ) {}

    public async getVoiceSettings(companyId: bigint): Promise<VoiceSettingModel> {
        return this.voiceRepository.fetchVoiceSettings(companyId);
    }

    public async updateVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void> {
        await this.voiceRepository.updateVoiceSettings(companyId, settings);
    }

    public async insertVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void> {
        await this.voiceRepository.insertVoiceSettings(companyId, settings);
    }

    public async getReplyStyle(companyId: bigint): Promise<ReplyStyleModel> {
        return this.voiceRepository.fetchReplyStyle(companyId);
    }

    public async updateReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void> {
        await this.voiceRepository.updateReplyStyle(companyId, style);
    }

    public async insertReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void> {
        await this.voiceRepository.insertReplyStyle(companyId, style);
    }
}
