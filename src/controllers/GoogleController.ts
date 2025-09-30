// src/controllers/GoogleCalendarController.ts

import { Request, Response } from "express";
import {injectable, inject, container} from "tsyringe";
import { GoogleService } from "../business/services/GoogleService";
import { calendar_v3 } from "googleapis";

@injectable()
export class GoogleController {

    /**
     * Step 1: Redirect user to Google OAuth consent screen
     * GET /api/oauth2/google/url?companyId=<64-char-id>
     */
    async getAuthUrl(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const companyId = req.query.companyId as string;
        if (!companyId) {
            res.status(400).send("Missing companyId");
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
    async handleCallback(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const code = req.query.code as string;
        const companyId = req.query.state as string;
        const frontendUrl = process.env.FRONTEND_URL;

        if (!code || !companyId) {
            res.status(400).send("Missing code or state");
            return;
        }

        try {
            await service.connect(BigInt(companyId), code);
            // Redirect to frontend
            res.redirect(`${frontendUrl}/?tab=integrations`);
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
    async scheduleEvent(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const { companyId, event } = req.body as {
            companyId: string | number | bigint;
            event: calendar_v3.Schema$Event;
        };
        if (!companyId || !event) {
            res.status(400).send("Missing companyId or event");
            return;
        }

        try {
            const scheduled = await service.scheduleEvent(BigInt(companyId), event);
            res.json(scheduled);
        } catch (err) {
            console.error("❌ scheduleEvent failed:", err);
            res.status(500).send("Error scheduling event");
        }
    }

    async checkAvailability(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const { companyId, date, openHour, closeHour } = req.body as {
            companyId: string | number | bigint;
            date: string;
            openHour?: number | string;
            closeHour?: number | string;
        };

        if (!companyId || !date) {
            res.status(400).send("Missing companyId or date");
            return;
        }

        const parsedOpen = Number(openHour ?? 9);
        const parsedClose = Number(closeHour ?? 17);
        const safeOpen = Number.isFinite(parsedOpen) ? parsedOpen : 9;
        const safeClose = Number.isFinite(parsedClose) ? parsedClose : 17;

        try {
            const availableSlots = await service.getAvailableSlots(
                BigInt(companyId),
                date,
                safeOpen,
                safeClose
            );
            res.json({ availableSlots });
        } catch (err) {
            console.error("❌ checkAvailability failed:", err);
            res.status(500).send("Error fetching availability");
        }
    }

    async cancelEvent(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const { companyId, eventId, name, dateOfBirth } = req.body as {
            companyId: string | number | bigint;
            eventId: string;
            name?: string;
            dateOfBirth?: string;
        };

        if (!companyId || !eventId) {
            res.status(400).send("Missing companyId or eventId");
            return;
        }

        try {
            const success = await service.cancelEvent(BigInt(companyId), eventId, name, dateOfBirth);
            res.json({ success });
        } catch (err) {
            console.error("❌ cancelEvent failed:", err);
            res.status(500).send("Error cancelling event");
        }
    }

    async disconnect(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const companyId = (req as any).companyId;
        if (!companyId) {
            res.status(400).send("Missing companyId");
        }

        try {
            await service.disconnect(companyId);
            res.status(200).send("Google integration disconnected");
        } catch (err) {
            console.error("❌ disconnect failed:", err);
            res.status(500).send("Error disconnecting Google integration");
        }
    }
}
