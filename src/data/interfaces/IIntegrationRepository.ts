import { IntegrationModel } from "../../business/models/IntegrationModel";

export type CalendarIntegrationStatus = {
    googleConnected: boolean;
    outlookConnected: boolean;
};

export interface IIntegrationRepository {
    /**
     * Fetch all supported integrations, along with each company's connection status.
     */
    getAllWithStatus(companyId: bigint): Promise<IntegrationModel[]>;
    getCommerceConnections(companyId: bigint): Promise<{ shopify: boolean; woocommerce: boolean }>;

    hasCalendarConnected(companyId: bigint): Promise<boolean>;

    getCalendarIntegrationStatus(companyId: bigint): Promise<CalendarIntegrationStatus>;
}
