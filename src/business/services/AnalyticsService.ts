import { inject, injectable } from "tsyringe";
import { IAnalyticsRepository } from "../../data/interfaces/IAnalyticsRepository";

export type CallOverviewMetrics = {
    averageCallDurationSeconds: number;
    previousAverageCallDurationSeconds: number | null;
    totalCallDurationSeconds: number;
    previousTotalCallDurationSeconds: number | null;
    totalCalls: number;
    previousTotalCalls: number | null;
};

@injectable()
export class AnalyticsService {
    constructor(
        @inject("IAnalyticsRepository") private readonly analyticsRepository: IAnalyticsRepository
    ) {}

    public async getCallOverview(companyId: bigint): Promise<CallOverviewMetrics> {
        const overview = await this.analyticsRepository.getCallOverview(companyId);

        return {
            averageCallDurationSeconds: overview.averageCallDurationSeconds,
            previousAverageCallDurationSeconds: null,
            totalCallDurationSeconds: overview.totalDurationSeconds,
            previousTotalCallDurationSeconds: null,
            totalCalls: overview.totalCalls,
            previousTotalCalls: null,
        };
    }
}
