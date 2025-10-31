import { ResultSetHeader, RowDataPacket } from "mysql2";
import { PricingSettings } from "../../business/models/PricingSettings";
import {
    AdminUserRecord,
    ClientDetailRow,
    ClientListRow,
    ClientRecentCallRow,
    ClientWeeklyCallRow,
    DashboardSnapshotRecord,
    IAdminRepository,
    InvoiceListRow,
    RevenueHistoryDailyRow,
    RevenueHistoryMonthlyRow,
} from "../interfaces/IAdminRepository";
import { BaseRepository } from "./BaseRepository";

interface PricingRates {
    costRate: number;
    priceRate: number;
}

export class AdminRepository extends BaseRepository implements IAdminRepository {
    public async findAdminByEmail(email: string): Promise<AdminUserRecord | null> {
        const sql = `
            SELECT id, email, password_hash AS passwordHash, name
            FROM admin_users
            WHERE email = ?
            LIMIT 1
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [email]);
        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];
        return {
            id: Number(row.id),
            email: row.email as string,
            passwordHash: row.passwordHash as string,
            name: row.name as string,
        };
    }

    public async getPricingSettings(): Promise<PricingSettings | null> {
        const sql = `
            SELECT cost_per_minute, price_per_minute, updated_at
            FROM pricing_settings
            ORDER BY updated_at DESC
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, []);
        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];
        return {
            costPerMinute: Number(row.cost_per_minute ?? 0),
            pricePerMinute: Number(row.price_per_minute ?? 0),
            updatedAt: row.updated_at as Date,
        };
    }

    public async getDashboardSnapshot(): Promise<DashboardSnapshotRecord> {
        const rates = await this.getPricingRates();
        const sql = `
            WITH totals AS (
                SELECT
                    COUNT(*) AS total_calls,
                    COALESCE(SUM(duration_seconds), 0) AS total_seconds
                FROM company_call_logs
            ),
            current_period AS (
                SELECT
                    COUNT(*) AS current_calls,
                    COALESCE(SUM(duration_seconds), 0) AS current_seconds
                FROM company_call_logs
                WHERE started_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
            ),
            previous_period AS (
                SELECT
                    COUNT(*) AS previous_calls,
                    COALESCE(SUM(duration_seconds), 0) AS previous_seconds
                FROM company_call_logs
                WHERE started_at >= DATE_SUB(CURDATE(), INTERVAL 59 DAY)
                  AND started_at < DATE_SUB(CURDATE(), INTERVAL 29 DAY)
            ),
            live_calls AS (
                SELECT COUNT(*) AS live_calls
                FROM company_call_sessions
                WHERE ended_at IS NULL
            )
            SELECT
                totals.total_calls,
                totals.total_seconds,
                current_period.current_calls,
                current_period.current_seconds,
                previous_period.previous_calls,
                previous_period.previous_seconds,
                live_calls.live_calls
            FROM totals, current_period, previous_period, live_calls
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, []);
        const row = rows[0] ?? {
            total_calls: 0,
            total_seconds: 0,
            current_calls: 0,
            current_seconds: 0,
            previous_calls: 0,
            previous_seconds: 0,
            live_calls: 0,
        };

        const totalSeconds = Number(row.total_seconds ?? 0);
        const currentSeconds = Number(row.current_seconds ?? 0);
        const previousSeconds = Number(row.previous_seconds ?? 0);

        return {
            totalCalls: Number(row.total_calls ?? 0),
            totalSeconds,
            totalCosts: this.computeAmount(totalSeconds, rates.costRate),
            totalRevenue: this.computeAmount(totalSeconds, rates.priceRate),
            liveCalls: Number(row.live_calls ?? 0),
            currentCalls: Number(row.current_calls ?? 0),
            currentSeconds,
            currentCosts: this.computeAmount(currentSeconds, rates.costRate),
            currentRevenue: this.computeAmount(currentSeconds, rates.priceRate),
            previousCalls: Number(row.previous_calls ?? 0),
            previousSeconds,
            previousCosts: this.computeAmount(previousSeconds, rates.costRate),
            previousRevenue: this.computeAmount(previousSeconds, rates.priceRate),
        };
    }

    public async getRevenueHistoryMonthly(months: number): Promise<RevenueHistoryMonthlyRow[]> {
        const { priceRate } = await this.getPricingRates();
        const clampedMonths = Math.max(1, Math.min(months, 24));
        const lookbackMonths = Math.max(clampedMonths - 1, 0);
        const sql = `
            SELECT
                DATE_FORMAT(started_at, '%b') AS month_label,
                YEAR(started_at) AS year_value,
                MONTH(started_at) AS month_value,
                COALESCE(SUM(duration_seconds), 0) AS total_seconds
            FROM company_call_logs
            WHERE started_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
            GROUP BY YEAR(started_at), MONTH(started_at)
            ORDER BY YEAR(started_at), MONTH(started_at)
            LIMIT ?
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [lookbackMonths, clampedMonths]);
        return rows.map((row) => ({
            monthLabel: row.month_label as string,
            revenue: this.computeAmount(Number(row.total_seconds ?? 0), priceRate),
        }));
    }

    public async getRevenueHistoryDaily(): Promise<RevenueHistoryDailyRow[]> {
        const { priceRate } = await this.getPricingRates();
        const sql = `
            SELECT
                DATE_FORMAT(started_at, '%e') AS day_label,
                COALESCE(SUM(duration_seconds), 0) AS total_seconds
            FROM company_call_logs
            WHERE started_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            GROUP BY DATE(started_at)
            ORDER BY DATE(started_at)
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, []);
        return rows.map((row) => ({
            dayLabel: String(row.day_label ?? ""),
            revenue: this.computeAmount(Number(row.total_seconds ?? 0), priceRate),
        }));
    }

    public async getRecentInvoices(limit: number): Promise<InvoiceListRow[]> {
        const normalizedLimit = Math.max(1, Math.min(limit, 50));
        const sql = `
            SELECT
                i.invoice_number AS id,
                i.company_id,
                COALESCE(cd.name, c.email) AS client_name,
                i.amount,
                i.status,
                DATE_FORMAT(i.issued_date, '%Y-%m-%d') AS issued_date,
                DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date
            FROM company_invoices i
            JOIN company c ON c.id = i.company_id
            LEFT JOIN company_details cd ON cd.company_id = c.id
            ORDER BY i.issued_date DESC, i.invoice_number DESC
            LIMIT ?
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [normalizedLimit]);
        return rows.map((row) => ({
            id: row.id as string,
            clientId: Number(row.company_id),
            clientName: (row.client_name as string) ?? "",
            amount: Number(row.amount ?? 0),
            status: row.status as string,
            issuedDate: row.issued_date as string,
            dueDate: (row.due_date as string | null) ?? null,
        }));
    }

    public async getClients(): Promise<ClientListRow[]> {
        const rates = await this.getPricingRates();
        const sql = `
            WITH details AS (
                SELECT company_id, MAX(name) AS name
                FROM company_details
                GROUP BY company_id
            ),
            contacts AS (
                SELECT company_id, MAX(phone) AS phone, MAX(address) AS address
                FROM company_contacts
                GROUP BY company_id
            ),
            usage_totals AS (
                SELECT company_id, COUNT(*) AS total_calls, COALESCE(SUM(duration_seconds), 0) AS total_seconds
                FROM company_call_logs
                GROUP BY company_id
            )
            SELECT
                c.id,
                COALESCE(d.name, c.email) AS company_name,
                c.email,
                NULLIF(ct.phone, '') AS phone,
                NULLIF(c.twilio_number, '') AS twilio_number,
                COALESCE(u.total_calls, 0) AS total_calls,
                COALESCE(u.total_seconds, 0) AS total_seconds
            FROM company c
            LEFT JOIN details d ON d.company_id = c.id
            LEFT JOIN contacts ct ON ct.company_id = c.id
            LEFT JOIN usage_totals u ON u.company_id = c.id
            ORDER BY company_name, c.id
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, []);
        return rows.map((row) => {
            const totalSeconds = Number(row.total_seconds ?? 0);
            return {
                id: Number(row.id),
                name: (row.company_name as string) ?? "",
                email: row.email as string,
                phone: this.toNullableString(row.phone),
                twilioNumber: this.toNullableString(row.twilio_number),
                totalCalls: Number(row.total_calls ?? 0),
                totalSeconds,
                totalCosts: this.computeAmount(totalSeconds, rates.costRate),
                totalRevenue: this.computeAmount(totalSeconds, rates.priceRate),
            };
        });
    }

    public async getClientById(clientId: number): Promise<ClientDetailRow | null> {
        const rates = await this.getPricingRates();
        const sql = `
            WITH details AS (
                SELECT company_id, MAX(name) AS name
                FROM company_details
                WHERE company_id = ?
                GROUP BY company_id
            ),
            contacts AS (
                SELECT company_id, MAX(phone) AS phone, MAX(address) AS address
                FROM company_contacts
                WHERE company_id = ?
                GROUP BY company_id
            ),
            usage_totals AS (
                SELECT company_id, COUNT(*) AS total_calls, COALESCE(SUM(duration_seconds), 0) AS total_seconds
                FROM company_call_logs
                WHERE company_id = ?
                GROUP BY company_id
            )
            SELECT
                c.id,
                COALESCE(d.name, c.email) AS company_name,
                c.email,
                NULLIF(ct.phone, '') AS phone,
                NULLIF(ct.address, '') AS address,
                NULLIF(c.twilio_number, '') AS twilio_number,
                DATE_FORMAT(c.created_at, '%Y-%m-%d') AS joined_date,
                COALESCE(u.total_calls, 0) AS total_calls,
                COALESCE(u.total_seconds, 0) AS total_seconds
            FROM company c
            LEFT JOIN details d ON d.company_id = c.id
            LEFT JOIN contacts ct ON ct.company_id = c.id
            LEFT JOIN usage_totals u ON u.company_id = c.id
            WHERE c.id = ?
            LIMIT 1
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [clientId, clientId, clientId, clientId]);
        if (rows.length === 0) {
            return null;
        }

        const row = rows[0];
        const totalSeconds = Number(row.total_seconds ?? 0);
        return {
            id: Number(row.id),
            name: (row.company_name as string) ?? "",
            email: row.email as string,
            phone: this.toNullableString(row.phone),
            twilioNumber: this.toNullableString(row.twilio_number),
            address: this.toNullableString(row.address),
            totalCalls: Number(row.total_calls ?? 0),
            totalSeconds,
            totalCosts: this.computeAmount(totalSeconds, rates.costRate),
            totalRevenue: this.computeAmount(totalSeconds, rates.priceRate),
            joinedDate: row.joined_date as string,
        };
    }

    public async getClientWeeklyCallHistory(
        clientId: number,
        weeks: number
    ): Promise<ClientWeeklyCallRow[]> {
        const normalizedWeeks = Math.max(1, Math.min(weeks, 52));
        const sql = `
            SELECT
                DATE_ADD(DATE(started_at), INTERVAL (6 - WEEKDAY(started_at)) DAY) AS week_end,
                DATE_FORMAT(DATE_ADD(DATE(started_at), INTERVAL (6 - WEEKDAY(started_at)) DAY), '%b %e') AS week_label,
                COUNT(*) AS call_count
            FROM company_call_logs
            WHERE company_id = ?
              AND started_at >= DATE_SUB(CURDATE(), INTERVAL ? WEEK)
            GROUP BY week_end, week_label
            ORDER BY week_end DESC
            LIMIT ?
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [clientId, normalizedWeeks, normalizedWeeks]);
        return rows.map((row) => ({
            weekEndingLabel: row.week_label as string,
            callCount: Number(row.call_count ?? 0),
        }));
    }

    public async getClientRecentCalls(clientId: number, limit: number): Promise<ClientRecentCallRow[]> {
        const rates = await this.getPricingRates();
        const normalizedLimit = Math.max(1, Math.min(limit, 50));
        const sql = `
            SELECT
                id,
                started_at,
                ended_at,
                duration_seconds
            FROM company_call_logs
            WHERE company_id = ?
            ORDER BY started_at DESC
            LIMIT ?
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, [clientId, normalizedLimit]);
        return rows.map((row) => {
            const durationSeconds = row.duration_seconds !== null ? Number(row.duration_seconds) : null;
            const seconds = durationSeconds ?? 0;
            const endedAt = (row.ended_at as Date | null) ?? null;
            return {
                id: Number(row.id),
                startedAt: row.started_at as Date,
                durationSeconds,
                costAmount: this.computeAmount(seconds, rates.costRate),
                revenueAmount: this.computeAmount(seconds, rates.priceRate),
                status: this.deriveCallStatus(durationSeconds, endedAt),
            };
        });
    }

    public async updateClient(
        clientId: number,
        payload: {
            name: string;
            email: string;
            phone: string | null;
            twilioNumber: string | null;
            address: string | null;
        }
    ): Promise<void> {
        const updateCompanySql = `
            UPDATE company
            SET email = ?,
                twilio_number = ?,
                updated_at = NOW()
            WHERE id = ?
        `;

        await this.execute<ResultSetHeader>(updateCompanySql, [
            payload.email,
            this.ensureNonNullString(payload.twilioNumber),
            clientId,
        ]);

        const updateDetailsSql = `
            UPDATE company_details
            SET name = ?
            WHERE company_id = ?
        `;
        const detailsResult = await this.execute<ResultSetHeader>(updateDetailsSql, [
            payload.name,
            clientId,
        ]);

        if (detailsResult.affectedRows === 0) {
            const insertDetailsSql = `
                INSERT INTO company_details (company_id, name, industry, size, founded_year, description)
                VALUES (?, ?, '', '', YEAR(CURDATE()), '')
            `;
            await this.execute<ResultSetHeader>(insertDetailsSql, [clientId, payload.name]);
        }

        const updateContactSql = `
            UPDATE company_contacts
            SET phone = ?,
                address = ?,
                contact_email = ?
            WHERE company_id = ?
        `;
        const contactResult = await this.execute<ResultSetHeader>(updateContactSql, [
            this.ensureNonNullString(payload.phone),
            this.ensureNonNullString(payload.address),
            payload.email,
            clientId,
        ]);

        if (contactResult.affectedRows === 0) {
            const insertContactSql = `
                INSERT INTO company_contacts (company_id, website, phone, contact_email, address)
                VALUES (?, '', ?, ?, ?)
            `;
            await this.execute<ResultSetHeader>(insertContactSql, [
                clientId,
                this.ensureNonNullString(payload.phone),
                payload.email,
                this.ensureNonNullString(payload.address),
            ]);
        }
    }

    public async updateClientTwilioNumber(clientId: number, twilioNumber: string | null): Promise<void> {
        const sql = `
            UPDATE company
            SET twilio_number = ?,
                updated_at = NOW()
            WHERE id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [this.ensureNonNullString(twilioNumber), clientId]);
    }

    public async searchInvoices(status: string | null, search: string | null): Promise<InvoiceListRow[]> {
        const clauses: string[] = [];
        const params: any[] = [];

        if (status && status !== "all") {
            clauses.push("i.status = ?");
            params.push(status);
        }

        if (search && search.trim().length > 0) {
            clauses.push("(COALESCE(cd.name, c.email) LIKE ? OR i.invoice_number LIKE ?)");
            const pattern = `%${search.trim()}%`;
            params.push(pattern, pattern);
        }

        const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

        const sql = `
            SELECT
                i.invoice_number AS id,
                i.company_id,
                COALESCE(cd.name, c.email) AS client_name,
                i.amount,
                i.status,
                DATE_FORMAT(i.issued_date, '%Y-%m-%d') AS issued_date,
                DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date
            FROM company_invoices i
            JOIN company c ON c.id = i.company_id
            LEFT JOIN company_details cd ON cd.company_id = c.id
            ${whereClause}
            ORDER BY i.issued_date DESC, i.invoice_number DESC
        `;

        const rows = await this.execute<RowDataPacket[]>(sql, params);
        return rows.map((row) => ({
            id: row.id as string,
            clientId: Number(row.company_id),
            clientName: (row.client_name as string) ?? "",
            amount: Number(row.amount ?? 0),
            status: row.status as string,
            issuedDate: row.issued_date as string,
            dueDate: (row.due_date as string | null) ?? null,
        }));
    }

    public async updatePricing(costPerMinute: number, pricePerMinute: number): Promise<PricingSettings> {
        const sql = `
            INSERT INTO pricing_settings (id, cost_per_minute, price_per_minute, updated_at)
            VALUES (1, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                cost_per_minute = VALUES(cost_per_minute),
                price_per_minute = VALUES(price_per_minute),
                updated_at = NOW()
        `;

        await this.execute<ResultSetHeader>(sql, [costPerMinute, pricePerMinute]);

        const refreshed = await this.getPricingSettings();
        if (!refreshed) {
            return {
                costPerMinute,
                pricePerMinute,
                updatedAt: new Date(),
            };
        }

        return refreshed;
    }

    private async getPricingRates(): Promise<PricingRates> {
        const pricing = await this.getPricingSettings();
        return {
            costRate: pricing?.costPerMinute ?? 0,
            priceRate: pricing?.pricePerMinute ?? 0,
        };
    }

    private computeAmount(seconds: number, rate: number): number {
        if (!Number.isFinite(seconds) || seconds <= 0 || rate <= 0) {
            return 0;
        }
        const minutes = seconds / 60;
        return Number((minutes * rate).toFixed(2));
    }

    private deriveCallStatus(durationSeconds: number | null, endedAt: Date | null): string {
        if (!endedAt) {
            return "failed";
        }
        const duration = durationSeconds ?? 0;
        if (duration > 0) {
            return "completed";
        }
        return "missed";
    }

    private toNullableString(value: unknown): string | null {
        if (value === null || value === undefined) {
            return null;
        }
        const str = String(value).trim();
        return str.length === 0 ? null : str;
    }

    private ensureNonNullString(value: string | null | undefined): string {
        if (value === null || value === undefined) {
            return "";
        }
        return value.trim();
    }
}
