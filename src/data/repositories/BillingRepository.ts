import { ResultSetHeader, RowDataPacket } from "mysql2";
import {
    BillingProfileInput,
    BillingProfileRecord,
    IBillingRepository,
    InvoiceRecord,
    NewInvoiceInput,
} from "../interfaces/IBillingRepository";
import { BaseRepository } from "./BaseRepository";

export class BillingRepository extends BaseRepository implements IBillingRepository {
    public async upsertBillingProfile(profile: BillingProfileInput): Promise<BillingProfileRecord> {
        const existing = await this.getBillingProfile(profile.companyId);
        const next: BillingProfileInput = {
            companyId: profile.companyId,
            email: profile.email ?? existing?.email,
            companyName: profile.companyName ?? existing?.companyName,
            pricePerMinute:
                profile.pricePerMinute !== undefined
                    ? profile.pricePerMinute
                    : existing?.pricePerMinute ?? null,
            status: profile.status ?? existing?.status ?? "trial",
            trialEndsAt:
                profile.trialEndsAt !== undefined ? profile.trialEndsAt : existing?.trialEndsAt ?? null,
            mollieCustomerId:
                profile.mollieCustomerId !== undefined
                    ? profile.mollieCustomerId
                    : existing?.mollieCustomerId ?? null,
            mollieMandateId:
                profile.mollieMandateId !== undefined
                    ? profile.mollieMandateId
                    : existing?.mollieMandateId ?? null,
            lastBilledMonth:
                profile.lastBilledMonth !== undefined
                    ? profile.lastBilledMonth
                    : existing?.lastBilledMonth ?? null,
        };

        const sql = `
            INSERT INTO company_billing_profiles
                (company_id, price_per_minute, status, trial_ends_at, mollie_customer_id, mollie_mandate_id, last_billed_month, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                price_per_minute = VALUES(price_per_minute),
                status = VALUES(status),
                trial_ends_at = VALUES(trial_ends_at),
                mollie_customer_id = VALUES(mollie_customer_id),
                mollie_mandate_id = VALUES(mollie_mandate_id),
                last_billed_month = VALUES(last_billed_month),
                updated_at = NOW()
        `;

        await this.execute<ResultSetHeader>(sql, [
            next.companyId,
            next.pricePerMinute,
            next.status,
            next.trialEndsAt,
            next.mollieCustomerId,
            next.mollieMandateId,
            next.lastBilledMonth,
        ]);

        const refreshed = await this.getBillingProfile(profile.companyId);
        if (!refreshed) {
            throw new Error("Failed to upsert billing profile");
        }
        return refreshed;
    }

    public async getBillingProfile(companyId: bigint): Promise<BillingProfileRecord | null> {
        const sql = `
            SELECT
                c.id AS company_id,
                c.email,
                COALESCE(cd.name, c.email) AS company_name,
                c.created_at AS company_created_at,
                bp.price_per_minute,
                bp.status,
                bp.trial_ends_at,
                bp.mollie_customer_id,
                bp.mollie_mandate_id,
                bp.last_billed_month
            FROM company c
            LEFT JOIN company_details cd ON cd.company_id = c.id
            LEFT JOIN company_billing_profiles bp ON bp.company_id = c.id
            WHERE c.id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0];
        return {
            companyId: BigInt(row.company_id),
            email: row.email as string,
            companyName: (row.company_name as string) ?? row.email,
            companyCreatedAt: row.company_created_at ? new Date(row.company_created_at) : new Date(),
            pricePerMinute: row.price_per_minute !== null ? Number(row.price_per_minute) : null,
            status: (row.status as any) ?? "trial",
            trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
            mollieCustomerId: row.mollie_customer_id ? String(row.mollie_customer_id) : null,
            mollieMandateId: row.mollie_mandate_id ? String(row.mollie_mandate_id) : null,
            lastBilledMonth: row.last_billed_month ? new Date(row.last_billed_month) : null,
        };
    }

    public async getBillableCompanies(): Promise<BillingProfileRecord[]> {
        const sql = `
            SELECT
                c.id AS company_id,
                c.email,
                COALESCE(cd.name, c.email) AS company_name,
                c.created_at AS company_created_at,
                bp.price_per_minute,
                bp.status,
                bp.trial_ends_at,
                bp.mollie_customer_id,
                bp.mollie_mandate_id,
                bp.last_billed_month
            FROM company_billing_profiles bp
            JOIN company c ON c.id = bp.company_id
            LEFT JOIN company_details cd ON cd.company_id = c.id
            WHERE bp.status IN ('trial', 'active', 'past_due')
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, []);
        return rows.map((row) => ({
            companyId: BigInt(row.company_id),
            email: row.email as string,
            companyName: (row.company_name as string) ?? row.email,
            companyCreatedAt: row.company_created_at ? new Date(row.company_created_at) : new Date(),
            pricePerMinute: row.price_per_minute !== null ? Number(row.price_per_minute) : null,
            status: (row.status as any) ?? "trial",
            trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
            mollieCustomerId: row.mollie_customer_id ? String(row.mollie_customer_id) : null,
            mollieMandateId: row.mollie_mandate_id ? String(row.mollie_mandate_id) : null,
            lastBilledMonth: row.last_billed_month ? new Date(row.last_billed_month) : null,
        }));
    }

    public async markCompanyLastBilled(companyId: bigint, monthStart: Date): Promise<void> {
        const sql = `
            UPDATE company_billing_profiles
            SET last_billed_month = ?, updated_at = NOW()
            WHERE company_id = ?
        `;
        await this.execute<ResultSetHeader>(sql, [monthStart, companyId]);
    }

    public async createInvoice(input: NewInvoiceInput): Promise<InvoiceRecord> {
        const sql = `
            INSERT INTO company_invoices
                (invoice_number, company_id, amount, currency, status, issued_date, due_date, usage_seconds, price_per_minute, payment_id, payment_link, metadata, period_start, period_end, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                amount = VALUES(amount),
                currency = VALUES(currency),
                status = VALUES(status),
                issued_date = VALUES(issued_date),
                due_date = VALUES(due_date),
                usage_seconds = VALUES(usage_seconds),
                price_per_minute = VALUES(price_per_minute),
                payment_id = VALUES(payment_id),
                payment_link = VALUES(payment_link),
                metadata = VALUES(metadata),
                period_start = VALUES(period_start),
                period_end = VALUES(period_end),
                updated_at = NOW()
        `;

        const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

        await this.execute<ResultSetHeader>(sql, [
            input.invoiceNumber,
            input.companyId,
            input.amount,
            input.currency ?? "EUR",
            input.status,
            input.issuedDate,
            input.dueDate ?? null,
            input.usageSeconds ?? null,
            input.pricePerMinute ?? null,
            input.paymentId ?? null,
            input.paymentLink ?? null,
            metadataJson,
            input.periodStart ?? null,
            input.periodEnd ?? null,
        ]);

        const refreshed = await this.getInvoiceByNumber(input.invoiceNumber);
        if (!refreshed) {
            throw new Error("Failed to create invoice");
        }
        return refreshed;
    }

    public async getInvoiceByNumber(invoiceNumber: string): Promise<InvoiceRecord | null> {
        const sql = `
            SELECT
                invoice_number,
                company_id,
                amount,
                COALESCE(currency, 'EUR') AS currency,
                status,
                issued_date,
                due_date,
                usage_seconds,
                price_per_minute,
                payment_id,
                payment_link,
                metadata,
                period_start,
                period_end,
                created_at,
                updated_at
            FROM company_invoices
            WHERE invoice_number = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [invoiceNumber]);
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0];
        return {
            invoiceNumber: row.invoice_number as string,
            companyId: BigInt(row.company_id),
            amount: Number(row.amount ?? 0),
            currency: (row.currency as string) ?? "EUR",
            status: row.status as string,
            issuedDate: row.issued_date as Date,
            dueDate: row.due_date ? new Date(row.due_date) : null,
            usageSeconds: row.usage_seconds !== null ? Number(row.usage_seconds) : null,
            pricePerMinute: row.price_per_minute !== null ? Number(row.price_per_minute) : null,
            paymentId: row.payment_id ? String(row.payment_id) : null,
            paymentLink: row.payment_link ? String(row.payment_link) : null,
            metadata: row.metadata ? this.parseMetadata(row.metadata) : null,
            periodStart: row.period_start ? new Date(row.period_start) : null,
            periodEnd: row.period_end ? new Date(row.period_end) : null,
            createdAt: row.created_at ? new Date(row.created_at) : null,
            updatedAt: row.updated_at ? new Date(row.updated_at) : null,
        };
    }

    public async getLastInvoiceForCompany(companyId: bigint): Promise<InvoiceRecord | null> {
        const sql = `
            SELECT
                invoice_number,
                company_id,
                amount,
                COALESCE(currency, 'EUR') AS currency,
                status,
                issued_date,
                due_date,
                usage_seconds,
                price_per_minute,
                payment_id,
                payment_link,
                metadata,
                period_start,
                period_end,
                created_at,
                updated_at
            FROM company_invoices
            WHERE company_id = ?
            ORDER BY period_end DESC, issued_date DESC
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [companyId]);
        if (!rows.length) {
            return null;
        }
        const row = rows[0];
        return {
            invoiceNumber: row.invoice_number as string,
            companyId: BigInt(row.company_id),
            amount: Number(row.amount ?? 0),
            currency: (row.currency as string) ?? "EUR",
            status: row.status as string,
            issuedDate: row.issued_date as Date,
            dueDate: row.due_date ? new Date(row.due_date) : null,
            usageSeconds: row.usage_seconds !== null ? Number(row.usage_seconds) : null,
            pricePerMinute: row.price_per_minute !== null ? Number(row.price_per_minute) : null,
            paymentId: row.payment_id ? String(row.payment_id) : null,
            paymentLink: row.payment_link ? String(row.payment_link) : null,
            metadata: row.metadata ? this.parseMetadata(row.metadata) : null,
            periodStart: row.period_start ? new Date(row.period_start) : null,
            periodEnd: row.period_end ? new Date(row.period_end) : null,
            createdAt: row.created_at ? new Date(row.created_at) : null,
            updatedAt: row.updated_at ? new Date(row.updated_at) : null,
        };
    }

    public async findInvoiceByPaymentId(paymentId: string): Promise<InvoiceRecord | null> {
        const sql = `
            SELECT
                invoice_number,
                company_id,
                amount,
                COALESCE(currency, 'EUR') AS currency,
                status,
                issued_date,
                due_date,
                usage_seconds,
                price_per_minute,
                payment_id,
                payment_link,
                metadata,
                period_start,
                period_end,
                created_at,
                updated_at
            FROM company_invoices
            WHERE payment_id = ?
            LIMIT 1
        `;
        const rows = await this.execute<RowDataPacket[]>(sql, [paymentId]);
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0];
        return {
            invoiceNumber: row.invoice_number as string,
            companyId: BigInt(row.company_id),
            amount: Number(row.amount ?? 0),
            currency: (row.currency as string) ?? "EUR",
            status: row.status as string,
            issuedDate: row.issued_date as Date,
            dueDate: row.due_date ? new Date(row.due_date) : null,
            usageSeconds: row.usage_seconds !== null ? Number(row.usage_seconds) : null,
            pricePerMinute: row.price_per_minute !== null ? Number(row.price_per_minute) : null,
            paymentId: row.payment_id ? String(row.payment_id) : null,
            paymentLink: row.payment_link ? String(row.payment_link) : null,
            metadata: row.metadata ? this.parseMetadata(row.metadata) : null,
            periodStart: row.period_start ? new Date(row.period_start) : null,
            periodEnd: row.period_end ? new Date(row.period_end) : null,
            createdAt: row.created_at ? new Date(row.created_at) : null,
            updatedAt: row.updated_at ? new Date(row.updated_at) : null,
        };
    }

    public async updateInvoiceStatus(
        invoiceNumber: string,
        status: string,
        paymentLink?: string | null
    ): Promise<void> {
        const sql = `
            UPDATE company_invoices
            SET status = ?,
                payment_link = COALESCE(?, payment_link),
                updated_at = NOW()
            WHERE invoice_number = ?
        `;
        await this.execute<ResultSetHeader>(sql, [status, paymentLink ?? null, invoiceNumber]);
    }

    private parseMetadata(raw: any): Record<string, any> | null {
        if (!raw) {
            return null;
        }
        try {
            if (typeof raw === "string") {
                return JSON.parse(raw);
            }
            return raw as Record<string, any>;
        } catch (error) {
            console.warn("[BillingRepository] Failed to parse metadata for invoice:", error);
            return null;
        }
    }
}
