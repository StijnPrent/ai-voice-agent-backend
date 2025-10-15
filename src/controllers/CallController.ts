// src/controllers/CallController.ts
import { Response } from "express";
import { container } from "tsyringe";
import { CallLogService } from "../business/services/CallLogService";
import { AuthenticatedRequest } from "../middleware/auth";
import { ResourceNotFoundError } from "../business/errors/ResourceNotFoundError";
import { TranscriptNotReadyError } from "../business/errors/TranscriptNotReadyError";

export class CallController {
    private readonly callLogService: CallLogService;

    constructor() {
        this.callLogService = container.resolve(CallLogService);
    }

    public async getCallerNumbers(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Missing authenticated company." });
                return;
            }

            const rawLimit = req.query.limit;
            const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
            const parsedLimit = limitValue !== undefined ? Number(limitValue) : undefined;

            const numbers = await this.callLogService.getCallerNumbers(companyId, parsedLimit);
            res.json(numbers);
        } catch (error) {
            console.error("Failed to fetch caller numbers", error);
            res.status(500).json({ message: "Failed to fetch caller numbers." });
        }
    }

    public async getCallsByPhoneNumber(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Missing authenticated company." });
                return;
            }

            const rawPhoneNumber = req.query.phoneNumber;
            const phoneNumber = typeof rawPhoneNumber === "string" ? rawPhoneNumber.trim() : "";

            if (!phoneNumber) {
                res.status(400).json({ message: "phoneNumber query parameter is required." });
                return;
            }

            const rawLimit = req.query.limit;
            const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
            const parsedLimit = limitValue !== undefined ? Number(limitValue) : undefined;
            const safeLimit =
                Number.isFinite(parsedLimit) && parsedLimit !== undefined
                    ? Math.min(Math.max(Number(parsedLimit), 1), 200)
                    : undefined;

            const calls = await this.callLogService.getCallsByPhoneNumber(companyId, phoneNumber);
            const sliced = safeLimit ? calls.slice(0, safeLimit) : calls;
            res.json(
                sliced.map((call) => ({
                    callSid: call.callSid,
                    fromNumber: call.fromNumber ?? null,
                    startedAt: call.startedAt.toISOString(),
                    endedAt: call.endedAt ? call.endedAt.toISOString() : null,
                    vapiCallId: call.vapiCallId ?? undefined,
                }))
            );
        } catch (error) {
            console.error("Failed to fetch calls by phone number", error);
            res.status(500).json({ message: "Failed to fetch calls by phone number." });
        }
    }

    public async getCallDetails(req: AuthenticatedRequest, res: Response) {
        try {
            const companyId = req.companyId;
            if (!companyId) {
                res.status(400).json({ message: "Missing authenticated company." });
                return;
            }

            const { callSid } = req.params;
            if (!callSid) {
                res.status(400).json({ message: "callSid parameter is required." });
                return;
            }

            const details = await this.callLogService.getCallDetails(companyId, callSid);
            res.json({
                callSid: details.callSid,
                fromNumber: details.fromNumber ?? null,
                vapiCallId: details.vapiCallId ?? undefined,
                startedAt: details.startedAt.toISOString(),
                endedAt: details.endedAt ? details.endedAt.toISOString() : null,
                messages: details.messages.map((message) => ({
                    role: message.role,
                    content: message.content,
                    startTime: message.startTime,
                })),
            });
        } catch (error) {
            if (error instanceof ResourceNotFoundError) {
                res.status(404).json({ message: error.message });
                return;
            }
            if (error instanceof TranscriptNotReadyError) {
                res.status(409).json({ message: error.message });
                return;
            }

            console.error("Failed to fetch call details", error);
            res.status(500).json({ message: "Failed to fetch call details." });
        }
    }
}
