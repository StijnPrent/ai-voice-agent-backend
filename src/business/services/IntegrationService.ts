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

    async getAllWithStatus(companyId: bigint, useType?: string | null): Promise<IntegrationModel[]> {
        const baseUrl = (config.serverUrl || "").replace(/\/$/, "");
        const connectMap: Record<string, { url: string; method: string }> = {
            google: { url: `${baseUrl}/google/oauth2/url`, method: "GET" },
            "google calendar": { url: `${baseUrl}/google/oauth2/url`, method: "GET" },
            outlook: { url: `${baseUrl}/outlook/oauth2/url`, method: "GET" },
            "outlook calendar": { url: `${baseUrl}/outlook/oauth2/url`, method: "GET" },
            shopify: { url: `${baseUrl}/shopify/start`, method: "POST" },
            woocommerce: { url: `${baseUrl}/woocommerce/connect`, method: "POST" },
        };

        const list = await this.integrationRepository.getAllWithStatus(companyId);
        const filtered = this.filterByUseType(list, useType);

        return filtered.map((integration) => {
            const key = integration.name.toLowerCase();
            const mapping =
                connectMap[key] ||
                (key.includes("google") ? connectMap["google"] : key.includes("outlook") ? connectMap["outlook"] : undefined);
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

    private filterByUseType(list: IntegrationModel[], useType?: string | null): IntegrationModel[] {
        const normalized = (useType ?? "both").toLowerCase();
        if (normalized === "both") return list;

        const isAppointments = normalized === "appointments";
        const isEcommerce = normalized === "ecommerce";

        return list.filter((integration) => {
            const name = integration.name.toLowerCase();
            const isWhatsapp = name.includes("whatsapp");
            const isCalendar = name.includes("google") || name.includes("outlook") || name.includes("calendar");
            const isStore = name.includes("shopify") || name.includes("woo");

            // Always keep messaging (WhatsApp)
            if (isWhatsapp) return true;
            if (isAppointments && isCalendar) return true;
            if (isEcommerce && isStore) return true;
            return false;
        });
    }

    public async hasCalendarConnected(companyId: bigint): Promise<boolean> {
        const status = await this.getCalendarIntegrationStatus(companyId);
        return this.isCalendarConnected(status);
    }

    public async getCalendarIntegrationStatus(companyId: bigint): Promise<CalendarIntegrationStatus> {
        return this.integrationRepository.getCalendarIntegrationStatus(companyId);
    }

    public async getCommerceConnections(companyId: bigint): Promise<{ shopify: boolean; woocommerce: boolean }> {
        console.log("[IntegrationService] getCommerceConnections", companyId.toString());
        const result = await this.integrationRepository.getCommerceConnections(companyId);
        console.log("[IntegrationService] commerce connections result", companyId.toString(), result);
        return result;
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
