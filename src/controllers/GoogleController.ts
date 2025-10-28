// src/controllers/GoogleCalendarController.ts

import { Request, Response } from "express";
import {injectable, inject, container} from "tsyringe";
import { GoogleService } from "../business/services/GoogleService";
import type { CalendarAvailability } from "../business/services/GoogleService";
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

    private deriveAvailableRanges(availability: CalendarAvailability) {
        const { operatingWindow, busy } = availability;
        const windowStart = new Date(operatingWindow.start);
        const windowEnd = new Date(operatingWindow.end);

        if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
            return [];
        }

        const busyIntervals = busy
            .map((interval) => {
                const start = new Date(interval.start);
                const end = new Date(interval.end);
                if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
                    return null;
                }
                return { start, end };
            })
            .filter((interval): interval is { start: Date; end: Date } => interval !== null)
            .sort((a, b) => a.start.getTime() - b.start.getTime());

        const ranges: { start: string; end: string; durationMinutes: number }[] = [];
        let cursor = windowStart;

        for (const interval of busyIntervals) {
            if (interval.start > cursor) {
                const rangeStart = new Date(cursor.getTime());
                const rangeEnd = new Date(Math.min(interval.start.getTime(), windowEnd.getTime()));
                const duration = Math.max(0, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 60000));
                if (duration > 0) {
                    ranges.push({
                        start: rangeStart.toISOString(),
                        end: rangeEnd.toISOString(),
                        durationMinutes: duration,
                    });
                }
            }

            if (interval.end > cursor) {
                cursor = new Date(Math.min(interval.end.getTime(), windowEnd.getTime()));
            }

            if (cursor >= windowEnd) {
                break;
            }
        }

        if (cursor < windowEnd) {
            const duration = Math.max(0, Math.round((windowEnd.getTime() - cursor.getTime()) / 60000));
            if (duration > 0) {
                ranges.push({
                    start: cursor.toISOString(),
                    end: windowEnd.toISOString(),
                    durationMinutes: duration,
                });
            }
        }

        return ranges;
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
            const availability = await service.getAvailableSlots(
                BigInt(companyId),
                date,
                safeOpen,
                safeClose
            );
            const availableRanges = this.deriveAvailableRanges(availability);
            res.json({ availability, availableRanges });
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
        const { companyId, eventId, name, dateOfBirth } = req.body as {
            companyId: string | number | bigint;
            eventId: string;
            name?: string;
            dateOfBirth?: string;
        };

        if (!companyId || !eventId) {
            res.status(400).json({ message: "Missing companyId or eventId" });
            return;
        }

        try {
            const success = await service.cancelEvent(BigInt(companyId), eventId, name, dateOfBirth);
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
