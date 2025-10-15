// src/controllers/VoiceSettingsController.ts
import { Response } from "express";
import { container } from "tsyringe";
import { VoiceSettingsService } from "../business/services/VoiceSettingsService";
import { AuthenticatedRequest } from "../middleware/auth";
import { VoiceSettingModel } from "../business/models/VoiceSettingsModel";
import { ReplyStyleModel } from "../business/models/ReplyStyleModel";
import { AssistantSyncError } from "../business/errors/AssistantSyncError";

export class VoiceSettingsController {
    private get service(): VoiceSettingsService {
        return container.resolve(VoiceSettingsService);
    }

    private handleError(res: Response, err: unknown, defaultMessage: string): void {
        if (err instanceof AssistantSyncError) {
            console.error(err);
            res.status(err.statusCode).json({ messages: err.messages });
            return;
        }

        console.error(err);
        res.status(500).json({ message: defaultMessage });
    }

    public async getVoiceSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const settings = await this.service.getVoiceSettings(companyId);
            res.json(settings ? settings.toJSON() : null);
        } catch (err) {
            this.handleError(res, err, "Error fetching voice settings");
        }
    }

    public async updateVoiceSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
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
            const updated = await this.service.updateVoiceSettings(companyId, settings);
            res.json(updated.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error updating voice settings");
        }
    }

    public async insertVoiceSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
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
            const inserted = await this.service.insertVoiceSettings(companyId, settings);
            res.status(201).json(inserted.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error inserting voice settings");
        }
    }

    public async getReplyStyle(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
                return;
            }
            const style = await this.service.getReplyStyle(companyId);
            res.json(style ? style.toJSON() : null);
        } catch (err) {
            this.handleError(res, err, "Error fetching reply style");
        }
    }

    public async updateReplyStyle(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
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
            const updated = await this.service.updateReplyStyle(companyId, style);
            res.json(updated.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error updating reply style");
        }
    }

    public async insertReplyStyle(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Company ID is missing from token." });
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
            const inserted = await this.service.insertReplyStyle(companyId, style);
            res.status(201).json(inserted.toJSON());
        } catch (err) {
            this.handleError(res, err, "Error inserting reply style");
        }
    }
}
