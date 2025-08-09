
// src/controllers/OutlookController.ts

import { Request, Response } from "express";
import {injectable, inject, container} from "tsyringe";
import { OutlookService } from "../business/services/OutlookService";

@injectable()
export class OutlookController {

    /**
     * Step 1: Redirect user to Outlook OAuth consent screen
     * GET /api/oauth2/outlook/url?companyId=<64-char-id>
     */
    async getAuthUrl(req: Request, res: Response): Promise<void> {
        const service = container.resolve(OutlookService);
        const companyId = req.query.companyId as string;
        if (!companyId) {
            res.status(400).send("Missing companyId");
        }

        try {
            const url = await service.getAuthUrl(companyId);
            res.json({ url });
        } catch (err) {
            console.error("❌ getAuthUrl failed:", err);
            res.status(500).send("Error generating auth URL");
        }
    }

    /**
     * Step 2: Handle Outlook OAuth callback
     * GET /api/oauth2/outlook/callback?code=...&state=<companyId>
     */
    async handleCallback(req: Request, res: Response): Promise<void> {
        const service = container.resolve(OutlookService);
        const code = req.query.code as string;
        const companyId = req.query.state as string;
        const frontendurl = process.env.FRONTEND_URL;
        if (!code || !companyId) {
            res.status(400).send("Missing code or state");
        }

        try {
            await service.connect(BigInt(companyId), code);
            res.send(`${frontendurl}/integrations?success=true&provider=outlook`);
        } catch (err) {
            console.error("❌ handleCallback failed:", err);
            res.status(500).send("Error handling OAuth callback");
        }
    }

    /**
     * Step 3: Schedule a new event
     * POST /api/schedule/outlook
     * Body: { companyId: string; event: any }
     */
    async scheduleEvent(req: Request, res: Response): Promise<void> {
        const service = container.resolve(OutlookService);
        const { companyId, event } = req.body as { companyId: bigint; event: any };
        if (!companyId || !event) {
            res.status(400).send("Missing companyId or event");
        }

        try {
            const scheduled = await service.scheduleEvent(companyId, event);
            res.json(scheduled);
        } catch (err) {
            console.error("❌ scheduleEvent failed:", err);
            res.status(500).send("Error scheduling event");
        }
    }
}
