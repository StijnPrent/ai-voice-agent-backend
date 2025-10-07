// src/data/interfaces/ICallLogRepository.ts
export type CallLogRecord = {
    companyId: bigint;
    callSid: string;
    fromNumber: string | null;
    vapiCallId: string | null;
    startedAt: Date;
    endedAt: Date | null;
};

export interface ICallLogRepository {
    upsertCallLog(
        companyId: bigint,
        callSid: string,
        fromNumber: string | null,
        vapiCallId: string | null,
        startedAt: Date,
        endedAt: Date
    ): Promise<void>;

    getDistinctCallerNumbers(companyId: bigint, limit: number): Promise<string[]>;

    getCallBySid(companyId: bigint, callSid: string): Promise<CallLogRecord | null>;
}
