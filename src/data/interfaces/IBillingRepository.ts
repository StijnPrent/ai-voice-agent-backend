export type BillingStatus = "trial" | "active" | "past_due" | "inactive";

export interface BillingProfileRecord {
    companyId: bigint;
    email: string;
    companyName: string;
    companyCreatedAt: Date;
    pricePerMinute: number | null;
    status: BillingStatus;
    trialEndsAt: Date | null;
    mollieCustomerId: string | null;
    mollieMandateId: string | null;
    lastBilledMonth: Date | null;
}

export interface BillingProfileInput {
    companyId: bigint;
    email?: string;
    companyName?: string;
    pricePerMinute?: number | null;
    status?: BillingStatus | null;
    trialEndsAt?: Date | null;
    mollieCustomerId?: string | null;
    mollieMandateId?: string | null;
    lastBilledMonth?: Date | null;
}

export interface NewInvoiceInput {
    invoiceNumber: string;
    companyId: bigint;
    amount: number;
    currency?: string;
    status: string;
    issuedDate: Date;
    dueDate?: Date | null;
    usageSeconds?: number | null;
    pricePerMinute?: number | null;
    paymentId?: string | null;
    paymentLink?: string | null;
    metadata?: Record<string, any> | null;
    periodStart?: Date | null;
    periodEnd?: Date | null;
}

export interface InvoiceRecord {
    invoiceNumber: string;
    companyId: bigint;
    amount: number;
    currency: string;
    status: string;
    issuedDate: Date;
    dueDate: Date | null;
    usageSeconds?: number | null;
    pricePerMinute?: number | null;
    paymentId?: string | null;
    paymentLink?: string | null;
    metadata?: Record<string, any> | null;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
}

export interface IBillingRepository {
    upsertBillingProfile(profile: BillingProfileInput): Promise<BillingProfileRecord>;
    getBillingProfile(companyId: bigint): Promise<BillingProfileRecord | null>;
    getBillableCompanies(): Promise<BillingProfileRecord[]>;
    markCompanyLastBilled(companyId: bigint, monthStart: Date): Promise<void>;
    getLastInvoiceForCompany(companyId: bigint): Promise<InvoiceRecord | null>;
    createInvoice(input: NewInvoiceInput): Promise<InvoiceRecord>;
    getInvoiceByNumber(invoiceNumber: string): Promise<InvoiceRecord | null>;
    findInvoiceByPaymentId(paymentId: string): Promise<InvoiceRecord | null>;
    updateInvoiceStatus(
        invoiceNumber: string,
        status: string,
        paymentLink?: string | null
    ): Promise<void>;
}
