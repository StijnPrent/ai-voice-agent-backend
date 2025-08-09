import {UpdateModel} from "../../business/models/UpdateModel";
import {IUpdateRepository} from "../interfaces/IUpdateRepository";
import {RowDataPacket} from "mysql2";
import {BaseRepository} from "./BaseRepository";

export class UpdateRepository extends BaseRepository implements IUpdateRepository{
    public async fetchUpdates(companyId: bigint): Promise<UpdateModel[]> {
        const sql = `
            SELECT
                created_at AS createdAt,
                CONCAT('Bedrijf aangemaakt') AS \`update\`,
                'created' AS status
            FROM company
            WHERE id = ?

            UNION ALL

            SELECT
                updated_at AS createdAt,
                CONCAT('Bedrijf aangepast') AS \`update\`,
                'updated' AS status
            FROM company
            WHERE id = ?

            UNION ALL

            SELECT
                ci.created_at AS createdAt,
                CONCAT('Bedrijfs informatie toegevoegd: "', ci.info_value, '"') AS \`update\`,
                'created' AS status
            FROM company_info AS ci
            WHERE ci.company_id = ?

            UNION ALL

            SELECT
                gci.created_at AS createdAt,
                CONCAT('Google calander integratie gekoppeld') AS \`update\`,
                'created' AS status
            FROM google_calendar_integrations AS gci
            WHERE gci.company_id = ?

            UNION ALL

            SELECT
                gci.updated_at AS createdAt,
                CONCAT('Google Calendar integratie aangepast') AS \`update\`,
                'updated' AS status
            FROM google_calendar_integrations AS gci
            WHERE gci.company_id = ?

            UNION ALL

            SELECT
                i.created_at AS createdAt,
                CONCAT('Integratie toegevoegd: ', i.name) AS \`update\`,
                'created' AS status
            FROM integrations AS i
            WHERE i.id IN (
                SELECT integration_id FROM google_calendar_integrations WHERE company_id = ?
            )

            UNION ALL

            SELECT
                i.updated_at AS createdAt,
                CONCAT('Integratie aangepast: ', i.name) AS \`update\`,
                'updated' AS status
            FROM integrations AS i
            WHERE i.id IN (
                SELECT integration_id FROM google_calendar_integrations WHERE company_id = ?
            )

            UNION ALL

            SELECT
                p.created_at AS createdAt,
                CONCAT('Wachtwoord aangemaakt') AS \`update\`,
                'created' AS status
            FROM passwords AS p
            WHERE p.company_id = ?

            UNION ALL

            SELECT
                rs.updated_at AS createdAt,
                CONCAT('Reactie stijl aangepast: ', rs.name) AS \`update\`,
                'updated' AS status
            FROM reply_styles AS rs
            WHERE rs.company_id = ?

            UNION ALL

            SELECT
                vs.created_at AS createdAt,
                CONCAT('Stem instellingen aangemaakt') AS \`update\`,
                'created' AS status
            FROM voice_settings AS vs
            WHERE vs.company_id = ?

            UNION ALL

            SELECT
                vs.updated_at AS createdAt,
                CONCAT('Stem instellingen aangepast') AS \`update\`,
                'updated' AS status
            FROM voice_settings AS vs
            WHERE vs.company_id = ?

            ORDER BY createdAt DESC
            LIMIT 6;
        `;

        const params = new Array(12).fill(companyId);

        const rows = await this.execute<RowDataPacket[]>(sql, params);

        return rows.map(r => new UpdateModel(
            r.update as string,
            new Date(r.createdAt as string),
            r.status as string
        ))
    }
}