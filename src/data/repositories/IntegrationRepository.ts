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
          WHEN gci.company_id IS NOT NULL
            OR phi.company_id IS NOT NULL
          THEN 'connected'
          ELSE 'disconnected'
        END                    AS status,
        COALESCE(gci.updated_at, phi.updated_at) AS lastSync,
        i.updated_at           AS integrationUpdatedAt
      FROM integrations i
      LEFT JOIN google_calendar_integrations gci
        ON gci.integration_id = i.id
       AND gci.company_id    = ?
      LEFT JOIN phorest_integrations phi
        ON phi.integration_id = i.id
       AND phi.company_id    = ?
      ORDER BY i.name;
    `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId, companyId, companyId]);
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
        return status.googleConnected || status.outlookConnected || status.phorestConnected;
    }

    public async getCalendarIntegrationStatus(companyId: bigint): Promise<CalendarIntegrationStatus> {
        const sql = `
            SELECT
                EXISTS(SELECT 1 FROM google_calendar_integrations WHERE company_id = ?)  AS googleConnected,
                EXISTS(SELECT 1 FROM phorest_integrations WHERE company_id = ?)         AS phorestConnected
        `;
        const idParam = companyId.toString();
        const rows = await this.execute<RowDataPacket[]>(sql, [idParam, idParam, idParam]);
        const row = rows[0] ?? { googleConnected: 0, outlookConnected: 0, phorestConnected: 0 };
        return {
            googleConnected: Boolean(row.googleConnected),
            outlookConnected: Boolean(row.outlookConnected),
            phorestConnected: Boolean(row.phorestConnected),
        };
    }

}
