export type VapiSessionRecord = {
    callId: string;
    callSid: string | null;
    workerId: string;
    workerAddress: string | null;
    registeredAt: Date | null;
    expiresAt: Date | null;
};

export type UpsertVapiSessionInput = {
    callId: string;
    callSid: string | null;
    workerId: string;
    workerAddress: string | null;
    expiresAt: Date | null;
};

export interface IVapiSessionRepository {
    ensureInitialized(): Promise<void>;
    upsertSession(input: UpsertVapiSessionInput): Promise<void>;
    deleteSession(callId: string): Promise<void>;
    findSession(callId: string): Promise<VapiSessionRecord | null>;
    deleteExpiredSessions(): Promise<void>;
    clearWorkerSessions(workerId: string): Promise<void>;
}
