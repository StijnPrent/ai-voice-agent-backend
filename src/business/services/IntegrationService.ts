import { CalendarIntegrationStatus, IIntegrationRepository } from "../../data/interfaces/IIntegrationRepository";
import { inject, injectable } from "tsyringe";
import { IntegrationModel } from "../models/IntegrationModel";
import config from "../../config/config";

export type CalendarProvider = "google" | "outlook";

@injectable()
export class IntegrationService {

    constructor(
        @inject("IIntegrationRepository") private integrationRepository: IIntegrationRepository
    ) {}

    async getAllWithStatus(companyId: bigint): Promise<IntegrationModel[]> {
        const baseUrl = (config.serverUrl || "").replace(/\/$/, "");
        const connectMap: Record<string, { url: string; method: string }> = {
            google: { url: `${baseUrl}/google/oauth2/url`, method: "GET" },
            outlook: { url: `${baseUrl}/outlook/oauth2/url`, method: "GET" },
            shopify: { url: `${baseUrl}/shopify/start`, method: "POST" },
            woocommerce: { url: `${baseUrl}/woocommerce/connect`, method: "POST" },
        };

        const list = await this.integrationRepository.getAllWithStatus(companyId);
        return list.map((integration) => {
            const key = integration.name.toLowerCase();
            const mapping = connectMap[key];
            return new IntegrationModel(
                integration.integrationId,
                integration.name,
                integration.description,
                integration.category,
                integration.logo,
                integration.status,
                integration.lastSync,
                integration.updatedAt,
                mapping?.url ?? null,
                mapping?.method ?? null
            );
        });
    }

    public async hasCalendarConnected(companyId: bigint): Promise<boolean> {
        const status = await this.getCalendarIntegrationStatus(companyId);
        return this.isCalendarConnected(status);
    }

    public async getCalendarIntegrationStatus(companyId: bigint): Promise<CalendarIntegrationStatus> {
        return this.integrationRepository.getCalendarIntegrationStatus(companyId);
    }

    public isCalendarConnected(status: CalendarIntegrationStatus): boolean {
        return status.googleConnected || status.outlookConnected;
    }

    public pickCalendarProvider(status: CalendarIntegrationStatus): CalendarProvider | null {
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
