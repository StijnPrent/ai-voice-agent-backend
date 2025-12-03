import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { CalendarIntegrationStatus, IIntegrationRepository } from "../interfaces/IIntegrationRepository";
import {IntegrationModel} from "../../business/models/IntegrationModel";

export class IntegrationRepository extends BaseRepository implements IIntegrationRepository {

    public async getAllWithStatus(
        companyId: bigint
    ): Promise<IntegrationModel[]> {
        const hasGoogle = await this.tableExists("google_calendar_integrations");
        const hasOutlook = await this.tableExists("outlook_calendar_integrations");
        const hasWoo = await this.tableExists("woocommerce_integrations");
        const hasShopify = await this.tableExists("shopify_integrations");

        const joins: string[] = [];
        const params: any[] = [];
        const statusCases: string[] = [];
        const lastSyncCases: string[] = [];
        const idParam = companyId.toString();

        if (hasGoogle) {
            joins.push(
                `LEFT JOIN google_calendar_integrations gci ON gci.integration_id = i.id AND gci.company_id = ?`
            );
            params.push(idParam);
            statusCases.push(`WHEN LOWER(i.name) LIKE 'google%'  AND gci.company_id IS NOT NULL THEN 'connected'`);
            lastSyncCases.push(`WHEN LOWER(i.name) LIKE 'google%'  THEN gci.updated_at`);
        }
        if (hasOutlook) {
            joins.push(
                `LEFT JOIN outlook_calendar_integrations oci ON oci.integration_id = i.id AND oci.company_id = ?`
            );
            params.push(idParam);
            statusCases.push(`WHEN LOWER(i.name) LIKE 'outlook%' AND oci.company_id IS NOT NULL THEN 'connected'`);
            lastSyncCases.push(`WHEN LOWER(i.name) LIKE 'outlook%' THEN oci.updated_at`);
        }
        if (hasWoo) {
            joins.push(`LEFT JOIN woocommerce_integrations wci ON wci.company_id = ?`);
            params.push(idParam);
            statusCases.push(`WHEN LOWER(i.name) LIKE 'woo%'     AND wci.company_id IS NOT NULL THEN 'connected'`);
            lastSyncCases.push(`WHEN LOWER(i.name) LIKE 'woo%'     THEN wci.updated_at`);
        }
        if (hasShopify) {
            joins.push(`LEFT JOIN shopify_integrations sci ON sci.company_id = ?`);
            params.push(idParam);
            statusCases.push(`WHEN LOWER(i.name) LIKE 'shopify%' AND sci.company_id IS NOT NULL THEN 'connected'`);
            lastSyncCases.push(`WHEN LOWER(i.name) LIKE 'shopify%' THEN sci.updated_at`);
        }

        const sql = `
            SELECT
                i.id         AS integrationId,
                i.name       AS name,
                i.description AS description,
                i.category   AS category,
                i.logo       AS logo,
                CASE
                    ${statusCases.join("\n                    ")}
                    ELSE 'disconnected'
                END AS status,
                CASE
                    ${lastSyncCases.join("\n                    ")}
                    ELSE NULL
                END AS lastSync,
                i.updated_at AS integrationUpdatedAt
            FROM integrations i
            ${joins.join("\n")}
            ORDER BY i.name;
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, params);
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
        return status.googleConnected || status.outlookConnected;
    }

    public async getCalendarIntegrationStatus(companyId: bigint): Promise<CalendarIntegrationStatus> {
        const hasGoogle = await this.tableExists("google_calendar_integrations");
        const hasOutlook = await this.tableExists("outlook_calendar_integrations");
        const idParam = companyId.toString();

        if (!hasGoogle && !hasOutlook) {
            return { googleConnected: false, outlookConnected: false };
        }

        const selectParts: string[] = [];
        const params: any[] = [];
        if (hasGoogle) {
            selectParts.push(`EXISTS(SELECT 1 FROM google_calendar_integrations WHERE company_id = ?) AS googleConnected`);
            params.push(idParam);
        } else {
            selectParts.push(`FALSE AS googleConnected`);
        }

        if (hasOutlook) {
            selectParts.push(`EXISTS(SELECT 1 FROM outlook_calendar_integrations WHERE company_id = ?) AS outlookConnected`);
            params.push(idParam);
        } else {
            selectParts.push(`FALSE AS outlookConnected`);
        }

        const sql = `SELECT ${selectParts.join(", ")}`;
        const rows = await this.execute<RowDataPacket[]>(sql, params);
        const row = rows[0] ?? { googleConnected: 0, outlookConnected: 0 };
        return {
            googleConnected: Boolean(row.googleConnected),
            outlookConnected: Boolean(row.outlookConnected),
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
