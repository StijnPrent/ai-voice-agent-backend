// src/controllers/VoiceSettingsController.ts
import { Response } from "express";
import { container } from "tsyringe";
import { VoiceSettingsService } from "../business/services/VoiceSettingsService";
import { AuthenticatedRequest } from "../middleware/auth";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";
import { ReplyStyleModel } from "../business/models/ReplyStyleModel";

export class VoiceSettingsController {
    private get service(): VoiceSettingsService {
        return container.resolve(VoiceSettingsService);
    }

    public async getVoiceSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const settings = await this.service.getVoiceSettings(companyId);
            res.json(settings);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching voice settings");
        }
    }

    public async updateVoiceSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const settings = new VoiceSettingModel(
                0, // id is not used for update
                Number(companyId),
                req.body.welcomePhrase,
                req.body.talkingSpeed,
                req.body.voiceId,
                new Date(), // createdAt is not used for update
                new Date() // updatedAt is not used for update
            );
            await this.service.updateVoiceSettings(companyId, settings);
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating voice settings");
        }
    }

    public async insertVoiceSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const settings = new VoiceSettingModel(
                0, // id is not used for insert
                Number(companyId),
                req.body.welcomePhrase,
                req.body.talkingSpeed,
                req.body.voiceId,
                new Date(), // createdAt is not used for insert
                new Date() // updatedAt is not used for insert
            );
            await this.service.insertVoiceSettings(companyId, settings);
            res.status(201).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error inserting voice settings");
        }
    }

    public async getReplyStyle(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const style = await this.service.getReplyStyle(companyId);
            res.json(style);
        } catch (err) {
            console.error(err);
            res.status(500).send("Error fetching reply style");
        }
    }

    public async updateReplyStyle(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const style = new ReplyStyleModel(
                0, // id is not used for update
                Number(companyId),
                req.body.name,
                req.body.description,
                new Date(), // createdAt is not used for update
                new Date() // updatedAt is not used for update
            );
            await this.service.updateReplyStyle(companyId, style);
            res.status(204).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error updating reply style");
        }
    }

    public async insertReplyStyle(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).send("Company ID is missing from token.");
                return;
            }
            const style = new ReplyStyleModel(
                0, // id is not used for insert
                Number(companyId),
                req.body.name,
                req.body.description,
                new Date(), // createdAt is not used for insert
                new Date() // updatedAt is not used for insert
            );
            await this.service.insertReplyStyle(companyId, style);
            res.status(201).send();
        } catch (err) {
            console.error(err);
            res.status(500).send("Error inserting reply style");
        }
    }
}