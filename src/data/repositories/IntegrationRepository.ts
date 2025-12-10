import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { CalendarIntegrationStatus, IIntegrationRepository } from "../interfaces/IIntegrationRepository";
import {IntegrationModel} from "../../business/models/IntegrationModel";

export class IntegrationRepository extends BaseRepository implements IIntegrationRepository {

    public async getAllWithStatus(
        companyId: bigint
    ): Promise<IntegrationModel[]> {
        const sql = `
      SELECT
        i.id                   AS integrationId,
        i.name                 AS name,
        i.description          AS description,
        i.category             AS category,
        i.logo                 AS logo,
        CASE
          WHEN gci.company_id IS NOT NULL THEN 'connected'
          ELSE 'disconnected'
        END                    AS status,
        gci.updated_at     AS lastSync,
        i.updated_at           AS integrationUpdatedAt
      FROM integrations i
      LEFT JOIN google_calendar_integrations gci
        ON gci.integration_id = i.id
       AND gci.company_id    = ?
      ORDER BY i.name;
    `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        return rows.map(r => new IntegrationModel(
            r.integrationId,
            r.name,
            r.description,
            r.category,
            r.logo,
            r.status,
            r.lastSync,
            r.integrationUpdatedAt
        ));
    }

    public async hasCalendarConnected(companyId: bigint): Promise<boolean> {
        const status = await this.getCalendarIntegrationStatus(companyId);
        return status.googleConnected;
    }

    public async getCalendarIntegrationStatus(companyId: bigint): Promise<CalendarIntegrationStatus> {
        const sql = `
            SELECT
                EXISTS(SELECT 1 FROM google_calendar_integrations WHERE company_id = ?)   AS googleConnected
        `;
        const idParam = companyId.toString();
        const rows = await this.execute<RowDataPacket[]>(sql, [idParam]);
        const row = rows[0] ?? { googleConnected: 0 };
        return {
            googleConnected: Boolean(row.googleConnected),
        };
    }

    public async getCommerceConnections(companyId: bigint): Promise<{ shopify: boolean; woocommerce: boolean }> {
        const idParam = companyId.toString();
        console.log("Checking commerce connections for companyId:", idParam);

        let shopifyConnected = false;
        let wooConnected = false;

        // Query directly; if table is missing, swallow and return false.
        try {
            const sqlShopify = `SELECT 1 FROM shopify_integrations WHERE company_id = ? LIMIT 1`;
            const rows = await this.execute<RowDataPacket[]>(sqlShopify, [idParam]);
            shopifyConnected = rows.length > 0;
        } catch (err) {
            console.warn("[IntegrationRepository] shopify_integrations not available or query failed", err);
        }

        try {
            const sqlWoo = `SELECT 1 FROM woocommerce_integrations WHERE company_id = ? LIMIT 1`;
            const rows = await this.execute<RowDataPacket[]>(sqlWoo, [idParam]);
            console.log(rows.length)
            wooConnected = rows.length > 0;
        } catch (err) {
            console.warn("[IntegrationRepository] woocommerce_integrations not available or query failed", err);
        }

        return { shopify: shopifyConnected, woocommerce: wooConnected };
    }

    private async tableExists(tableName: string): Promise<boolean> {
        const sql = `
            SELECT COUNT(*) AS cnt
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name = ?
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [tableName]);
        const cnt = rows[0]?.cnt ?? 0;
        return Number(cnt) > 0;
    }
}
