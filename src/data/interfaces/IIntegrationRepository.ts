import { IntegrationModel } from "../../business/models/IntegrationModel";

export interface IIntegrationRepository {
    /**
     * Fetch all supported integrations, along with each company's connection status.
     */
    getAllWithStatus(companyId: bigint): Promise<IntegrationModel[]>;

    hasCalendarConnected(companyId: bigint): Promise<boolean>;
}
