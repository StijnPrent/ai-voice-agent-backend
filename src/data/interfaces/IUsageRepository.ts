export interface IUsageRepository {
    /**
     * Persist a detailed log entry for a completed call.
     */
    recordCall(
        companyId: bigint,
        callSid: string,
        startedAt: Date,
        endedAt: Date,
        durationSeconds: number
    ): Promise<void>;

    /**
     * Increment the aggregated monthly usage counter for billing.
     */
    incrementMonthlyUsage(
        companyId: bigint,
        usageDate: Date,
        durationSeconds: number
    ): Promise<void>;

    /**
     * Fetch the aggregated usage (in seconds) for a given month.
     */
    getUsageForMonth(companyId: bigint, year: number, month: number): Promise<number>;
}
