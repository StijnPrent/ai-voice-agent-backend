// src/business/services/CallLogService.ts
import { inject, injectable } from "tsyringe";
import { ICallLogRepository } from "../../data/interfaces/ICallLogRepository";
import { VapiClient } from "../../clients/VapiClient";

export type CallTranscriptMessage = {
    role: string;
    content: string;
    startTime: number | null;
};

export type CallDetailsResponse = {
    callSid: string;
    fromNumber: string | null;
    vapiCallId: string | null;
    startedAt: Date;
    endedAt: Date | null;
    messages: CallTranscriptMessage[];
};

@injectable()
export class CallLogService {
    constructor(
        @inject("ICallLogRepository") private readonly callLogRepository: ICallLogRepository,
        @inject(VapiClient) private readonly vapiClient: VapiClient
    ) {}

    public async recordCallSession(
        companyId: bigint,
        callSid: string,
        fromNumber: string | null,
        vapiCallId: string | null,
        startedAt: Date,
        endedAt: Date
    ): Promise<void> {
        await this.callLogRepository.upsertCallLog(
            companyId,
            callSid,
            fromNumber,
            vapiCallId,
            startedAt,
            endedAt
        );
    }

    public async getCallerNumbers(companyId: bigint, limit?: number): Promise<string[]> {
        return this.callLogRepository.getDistinctCallerNumbers(companyId, limit ?? 50);
    }

    public async getCallDetails(companyId: bigint, callSid: string): Promise<CallDetailsResponse> {
        const record = await this.callLogRepository.getCallBySid(companyId, callSid);
        if (!record) {
            throw new Error("Call not found for the specified company.");
        }

        if (!record.vapiCallId) {
            throw new Error("No Vapi call ID stored for this call.");
        }

        const details = await this.vapiClient.fetchCallDetails(record.vapiCallId);

        const messages: CallTranscriptMessage[] = [];

        if (details && typeof details === "object" && "messages" in details) {
            const rawMessages = (details as { messages?: unknown }).messages;
            if (Array.isArray(rawMessages)) {
                for (const entry of rawMessages) {
                    if (!entry || typeof entry !== "object") {
                        continue;
                    }

                    const role = typeof (entry as { role?: unknown }).role === "string"
                        ? (entry as { role: string }).role
                        : "";

                    const messageText = typeof (entry as { message?: unknown }).message === "string"
                        ? (entry as { message: string }).message
                        : typeof (entry as { originalMessage?: unknown }).originalMessage === "string"
                            ? (entry as { originalMessage: string }).originalMessage
                            : "";

                    const secondsFromStartValue = (entry as { secondsFromStart?: unknown }).secondsFromStart;
                    const timeValue = (entry as { time?: unknown }).time;

                    const parsedSecondsFromStart = Number(secondsFromStartValue);
                    const parsedTime = Number(timeValue);

                    const startTime = Number.isFinite(parsedSecondsFromStart)
                        ? parsedSecondsFromStart
                        : Number.isFinite(parsedTime)
                            ? parsedTime
                            : null;

                    if (!role && !messageText && startTime === null) {
                        continue;
                    }

                    messages.push({
                        role,
                        content: messageText,
                        startTime,
                    });
                }

                messages.sort((left, right) => {
                    if (left.startTime === null && right.startTime === null) {
                        return 0;
                    }
                    if (left.startTime === null) {
                        return 1;
                    }
                    if (right.startTime === null) {
                        return -1;
                    }
                    return left.startTime - right.startTime;
                });
            }
        }

        return {
            callSid: record.callSid,
            fromNumber: record.fromNumber,
            vapiCallId: record.vapiCallId,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
            messages,
        };
    }
}
