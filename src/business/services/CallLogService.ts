// src/business/services/CallLogService.ts
import { inject, injectable } from "tsyringe";
import { ICallLogRepository } from "../../data/interfaces/ICallLogRepository";
import { VapiClient } from "../../clients/VapiClient";

export type CallDetailsResponse = {
    callSid: string;
    fromNumber: string | null;
    vapiCallId: string | null;
    startedAt: Date;
    endedAt: Date | null;
    vapiDetails: unknown;
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
        return {
            callSid: record.callSid,
            fromNumber: record.fromNumber,
            vapiCallId: record.vapiCallId,
            startedAt: record.startedAt,
            endedAt: record.endedAt,
            vapiDetails: details,
        };
    }
}
