import { CalendarIntegrationStatus, IIntegrationRepository } from "../../data/interfaces/IIntegrationRepository";
import {inject, injectable} from "tsyringe";
import {IntegrationModel} from "../models/IntegrationModel";

export type CalendarProvider = "google" | "outlook" | "phorest";

@injectable()
export class IntegrationService {

    constructor(
        @inject("IIntegrationRepository") private integrationRepository: IIntegrationRepository
    ) {}

    async getAllWithStatus(companyId: bigint): Promise<IntegrationModel[]> {
        return this.integrationRepository.getAllWithStatus(companyId);
    }

    public async hasCalendarConnected(companyId: bigint): Promise<boolean> {
        const status = await this.getCalendarIntegrationStatus(companyId);
        return this.isCalendarConnected(status);
    }

    public async getCalendarIntegrationStatus(companyId: bigint): Promise<CalendarIntegrationStatus> {
        return this.integrationRepository.getCalendarIntegrationStatus(companyId);
    }

    public isCalendarConnected(status: CalendarIntegrationStatus): boolean {
        return status.googleConnected || status.outlookConnected || status.phorestConnected;
    }

    public pickCalendarProvider(status: CalendarIntegrationStatus): CalendarProvider | null {
        if (status.phorestConnected) {
            return "phorest";
        }
        if (status.googleConnected) {
            return "google";
        }
        if (status.outlookConnected) {
            return "outlook";
        }
        return null;
    }

    public async getCalendarProvider(companyId: bigint): Promise<CalendarProvider | null> {
        const status = await this.getCalendarIntegrationStatus(companyId);
        return this.pickCalendarProvider(status);
    }
}
