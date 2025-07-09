import { RowDataPacket } from "mysql2";
import { BaseRepository } from "./BaseRepository";
import { IIntegrationRepository } from "../interfaces/IIntegrationRepository";
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
        CASE WHEN gci.company_id IS NOT NULL THEN 'connected' ELSE 'disconnected' END AS status,
        gci.updated_at         AS lastSync
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
            r.updatedAt
        ));
    }

    public async hasCalendarConnected(companyId: bigint): Promise<boolean> {
        const sql = `
      SELECT COUNT(1)      AS cnt
        FROM google_calendar_integrations
       WHERE company_id = ?
    `;
        const [rows] = await this.execute<RowDataPacket[]>(sql, [companyId]);
        const cnt = rows[0]?.cnt as number;
        return cnt > 0;
    }
}