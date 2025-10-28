// src/controllers/GoogleCalendarController.ts

import { Request, Response } from "express";
import {injectable, inject, container} from "tsyringe";
import { GoogleService } from "../business/services/GoogleService";
import { GoogleReauthRequiredError } from "../business/errors/GoogleReauthRequiredError";
import { calendar_v3 } from "googleapis";

@injectable()
export class GoogleController {

    /**
     * Step 1: Redirect user to Google OAuth consent screen
     * GET /api/oauth2/google/url?companyId=<64-char-id>
     */
    async getAuthUrl(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const rawCompanyId = req.query.companyId;
        const companyId = typeof rawCompanyId === "string" ? rawCompanyId.trim() : "";
        if (!companyId) {
            res.status(400).json({ message: "Missing companyId" });
            return;
        }
        try {
            const url = service.getAuthUrl(companyId);
            res.json({ url });
        } catch (err) {
            console.error("❌ getAuthUrl failed:", err);
            res.status(500).json({ message: "Error generating auth URL" });
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
            res.status(400).json({ message: "Missing code or state" });
            return;
        }

        try {
            await service.connect(BigInt(companyId), code);
            // Redirect to frontend
            res.redirect(`${frontendUrl}/?tab=integrations`);
        } catch (err) {
            console.error("❌ handleCallback failed:", err);
            res.status(500).json({ message: "Error handling OAuth callback" });
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
            res.status(400).json({ message: "Missing companyId or event" });
            return;
        }

        try {
            const scheduled = await service.scheduleEvent(BigInt(companyId), event);
            res.json(scheduled);
        } catch (err) {
            if (err instanceof GoogleReauthRequiredError) {
                res.status(err.statusCode).json({ message: err.message, authUrl: err.authUrl });
                return;
            }
            console.error("❌ scheduleEvent failed:", err);
            res.status(500).json({ message: "Error scheduling event" });
        }
    }

    async checkAvailability(req: Request, res: Response): Promise<void> {
        console.log(req.body)
        const service = container.resolve(GoogleService);
        const { companyId, date, openHour, closeHour } = req.body as {
            companyId: string | number | bigint;
            date: string;
            openHour?: number | string;
            closeHour?: number | string;
        };

        if (!companyId || !date) {
            res.status(400).json({ message: "Missing companyId or date" });
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
            if (err instanceof GoogleReauthRequiredError) {
                res.status(err.statusCode).json({ message: err.message, authUrl: err.authUrl });
                return;
            }
            console.error("❌ checkAvailability failed:", err);
            res.status(500).json({ message: "Error fetching availability" });
        }
    }

    async cancelEvent(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const { companyId, start, name, phoneNumber } = req.body as {
            companyId: string | number | bigint;
            start: string;
            name?: string;
            phoneNumber?: string;
        };

        if (!companyId || !start || !phoneNumber) {
            res.status(400).json({ message: "Missing companyId, start time, or phone number" });
            return;
        }

        try {
            const success = await service.cancelEvent(BigInt(companyId), start, phoneNumber, name);
            res.json({ success });
        } catch (err) {
            if (err instanceof GoogleReauthRequiredError) {
                res.status(err.statusCode).json({ message: err.message, authUrl: err.authUrl });
                return;
            }
            console.error("❌ cancelEvent failed:", err);
            res.status(500).json({ message: "Error cancelling event" });
        }
    }

    async disconnect(req: Request, res: Response): Promise<void> {
        const service = container.resolve(GoogleService);
        const companyId = (req as any).companyId;
        if (!companyId) {
            res.status(400).json({ message: "Missing companyId" });
            return;
        }

        let normalizedCompanyId: bigint;
        try {
            normalizedCompanyId =
                typeof companyId === "bigint" ? companyId : BigInt(companyId);
        } catch {
            res.status(400).json({ message: "Invalid company identifier." });
            return;
        }

        try {
            await service.disconnect(normalizedCompanyId);
            res.status(200).json({ message: "Google integration disconnected" });
        } catch (err) {
            console.error("❌ disconnect failed:", err);
            res.status(500).json({ message: "Error disconnecting Google integration" });
        }
    }
}
