// src/controllers/GoogleCalendarController.ts

import { Request, Response } from "express";
import {injectable, inject, container} from "tsyringe";
import { GoogleService } from "../business/services/GoogleService";
import { calendar_v3 } from "googleapis";

container.register("GoogleService", { useClass: GoogleService });

@injectable()
export class GoogleController {

    /**
     * Step 1: Redirect user to Google OAuth consent screen
     * GET /api/oauth2/google/url?companyId=<64-char-id>
     */
    async getAuthUrl(req: Request, res: Response) {
        const service = container.resolve(GoogleService);
        const companyId = req.query.companyId as string;
        if (!companyId) {
            return res.status(400).send("Missing companyId");
        }

        try {
            const url = service.getAuthUrl(companyId);
            res.json({ url });
        } catch (err) {
            console.error("❌ getAuthUrl failed:", err);
            res.status(500).send("Error generating auth URL");
        }
    }

    /**
     * Step 2: Handle Google OAuth callback
     * GET /api/oauth2/google/callback?code=...&state=<companyId>
     */
    async handleCallback(req: Request, res: Response) {
        const service = container.resolve(GoogleService);
        const code = req.query.code as string;
        const companyId = req.query.state as string;
        if (!code || !companyId) {
            return res.status(400).send("Missing code or state");
        }

        try {
            await service.connect(BigInt(companyId), code);
            res.send("✅ Google Calendar connected!");
        } catch (err) {
            console.error("❌ handleCallback failed:", err);
            res.status(500).send("Error handling OAuth callback");
        }
    }

    /**
     * Step 3: Schedule a new event
     * POST /api/schedule/google
     * Body: { companyId: string; event: calendar_v3.Schema$Event }
     */
    async scheduleEvent(req: Request, res: Response) {
        const service = container.resolve(GoogleService);
        const { companyId, event } = req.body as { companyId: bigint; event: calendar_v3.Schema$Event };
        if (!companyId || !event) {
            return res.status(400).send("Missing companyId or event");
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
