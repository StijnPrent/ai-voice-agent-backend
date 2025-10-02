// src/data/repositories/VoiceRepository.ts
import { IVoiceRepository } from "../interfaces/IVoiceRepository";
import { VoiceSettingModel } from "../../business/models/VoiceSettingsModel";
import { ReplyStyleModel } from "../../business/models/ReplyStyleModel";
import { BaseRepository } from "./BaseRepository";
import { RowDataPacket } from "mysql2";

export class VoiceRepository extends BaseRepository implements IVoiceRepository {
    public async fetchVoiceSettings(companyId: bigint): Promise<VoiceSettingModel> {
        const sql = "SELECT * FROM voice_settings WHERE company_id = ?";
        const results = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (results.length === 0) {
            throw new Error("No voice settings found for this company.");
        }
        const row = results[0];
        return new VoiceSettingModel(
            row.id,
            row.company_id,
            row.welcome_phrase,
            row.talking_speed,
            row.voice_id,
            row.created_at,
            row.updated_at
        );
    }

    public async updateVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void> {
        const sql = `
            UPDATE voice_settings
            SET welcome_phrase = ?, talking_speed = ?, voice_id = ?, updated_at = NOW()
            WHERE company_id = ?
        `;
        await this.execute(sql, [settings.welcomePhrase, settings.talkingSpeed, settings.voiceId, companyId]);
    }
    
    public async insertVoiceSettings(companyId: bigint, settings: VoiceSettingModel): Promise<void> {
        const sql = `
            INSERT INTO voice_settings (company_id, welcome_phrase, talking_speed, voice_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, NOW(), NOW())
        `;
        await this.execute(sql, [companyId, settings.welcomePhrase, settings.talkingSpeed, settings.voiceId]);
    }

    public async fetchReplyStyle(companyId: bigint): Promise<ReplyStyleModel> {
        const sql = "SELECT * FROM reply_styles WHERE company_id = ?";
        const results = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (results.length === 0) {
            throw new Error("No reply style found for this company.");
        }
        const row = results[0];
        return new ReplyStyleModel(
            row.id,
            row.company_id,
            row.name,
            row.description,
            row.created_at,
            row.updated_at
        );
    }

    public async updateReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void> {
        const sql = `
            UPDATE reply_styles
            SET name = ?, description = ?, updated_at = NOW()
            WHERE company_id = ?
        `;
        await this.execute(sql, [style.name, style.description, companyId]);
    }
    
    public async insertReplyStyle(companyId: bigint, style: ReplyStyleModel): Promise<void> {
        const sql = `
            INSERT INTO reply_styles (company_id, name, description, created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
        `;
        await this.execute(sql, [companyId, style.name, style.description]);
    }
}
