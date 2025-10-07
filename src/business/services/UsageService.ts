// src/business/services/UsageService.ts
import { inject, injectable } from "tsyringe";
import { IUsageRepository } from "../../data/interfaces/IUsageRepository";

@injectable()
export class UsageService {
    constructor(
        @inject("IUsageRepository") private readonly usageRepository: IUsageRepository
    ) {}

    public async recordCall(
        companyId: bigint,
        callSid: string,
        startedAt: Date,
        endedAt: Date
    ): Promise<void> {
        const durationSeconds = Math.max(
            0,
            Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
        );

        if (durationSeconds <= 0) {
            return;
        }

        await this.usageRepository.recordCall(
            companyId,
            callSid,
            startedAt,
            endedAt,
            durationSeconds
        );

        await this.usageRepository.incrementMonthlyUsage(
            companyId,
            startedAt,
            durationSeconds
        );
    }

    public async getUsageMinutesForMonth(
        companyId: bigint,
        year: number,
        month: number
    ): Promise<number> {
        const totalSeconds = await this.usageRepository.getUsageForMonth(
            companyId,
            year,
            month
        );

        return Math.ceil(totalSeconds / 60);
    }
}
