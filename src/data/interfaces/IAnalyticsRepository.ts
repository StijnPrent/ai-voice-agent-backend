export type CallOverviewRow = {
    totalCalls: number;
    totalDurationSeconds: number;
    averageCallDurationSeconds: number;
};

export interface IAnalyticsRepository {
    getCallOverview(companyId: bigint): Promise<CallOverviewRow>;
}
