import {VoiceSettingModel} from "../../business/models/VoiceSettingsModel";
import {ReplyStyleModel} from "../../business/models/ReplyStyleModel";

export interface IVoiceRepository {
    fetchVoiceSettings(companyId: bigint): Promise<VoiceSettingModel>
    updateVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void>
    insertVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void>
    fetchReplyStyle(companyId: bigint): Promise<ReplyStyleModel>
    updateReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void>
    insertReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void>
}