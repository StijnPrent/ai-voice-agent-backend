export class VoiceSettingsService {
    constructor(
        @Inject('IVoiceRepository') private voiceRepository: IVoiceRepository
    ) {}

    public async getVoiceSettings(companyId: bigint): Promise<VoiceSettingModel> {
        const settings = await this.voiceRepository.fetchVoiceSettings(companyId);
        if (!settings) {
            throw new Error(`No voice settings found for company ${companyId}`);
        }
        return settings;
    }

    public async updateVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void> {
        await this.voiceRepository.updateVoiceSettings(companyId, settings);
    }

    public async insertVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void> {
        await this.voiceRepository.insertVoiceSettings(companyId, settings);
    }

    public async getReplyStyle(companyId: bigint): Promise<ReplyStyleModel> {
        const style = await this.voiceRepository.fetchReplyStyle(companyId);
        if (!style) {
            throw new Error(`No reply style found for company ${companyId}`);
        }
        return style;
    }

    public async updateReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void> {
        await this.voiceRepository.updateReplyStyle(companyId, style);
    }

    public async insertReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void> {
        await this.voiceRepository.insertReplyStyle(companyId, style);
    }
}