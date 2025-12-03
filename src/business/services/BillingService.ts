import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import { Payment, SequenceType } from "@mollie/api-client";
import { MollieClient } from "../../clients/MollieClient";
import {
    BillingProfileInput,
    BillingProfileRecord,
    IBillingRepository,
    InvoiceRecord,
} from "../../data/interfaces/IBillingRepository";
import { IUsageRepository } from "../../data/interfaces/IUsageRepository";
import { IAdminRepository } from "../../data/interfaces/IAdminRepository";
import { TransactionalMailService } from "./TransactionalMailService";
import { CompanyService } from "./CompanyService";
import config from "../../config/config";

interface LandingSignupInput {
    companyName: string;
    contactName?: string;
    email: string;
    password: string;
    accessCode?: string;
    iban: string;
    accountHolderName: string;
    pricePerMinute?: number;
}

interface BillingRunResult {
    invoicesCreated: number;
    totalAmount: number;
    invoices: Array<{
        invoiceNumber: string;
        companyId: string;
        amount: number;
        status: string;
        paymentLink?: string | null;
        periodStart: string;
        periodEnd: string;
    }>;
}

@injectable()
export class BillingService {
    constructor(
        @inject("IBillingRepository") private readonly billingRepository: IBillingRepository,
        @inject("IUsageRepository") private readonly usageRepository: IUsageRepository,
        @inject("IAdminRepository") private readonly adminRepository: IAdminRepository,
        private readonly transactionalMail: TransactionalMailService,
        private readonly companyService: CompanyService
    ) {}

    private get mollie(): MollieClient {
        return new MollieClient(process.env.MOLLIE_API_KEY);
    }

    public async createLandingSignup(input: LandingSignupInput) {
        const company = await this.companyService.registerCompany({
            companyName: input.companyName,
            contactName: input.contactName,
            email: input.email,
            password: input.password,
            accessCode: input.accessCode,
        });

        const customer = await this.mollie.createCustomer({
            name: input.companyName,
            email: input.email,
        });

        const mandate = await this.mollie.createMandate({
            customerId: customer.id ?? "",
            consumerName: input.accountHolderName,
            consumerAccount: input.iban,
            mandateReference: `CB-${company.id.toString()}`,
        });

        const trialEndsAt = this.addDays(new Date(), 14);

        await this.billingRepository.upsertBillingProfile({
            companyId: company.id,
            companyName: input.companyName,
            email: input.email,
            pricePerMinute: input.pricePerMinute ?? null,
            status: "trial",
            trialEndsAt,
            mollieCustomerId: customer.id ?? null,
            mollieMandateId: mandate.id ?? null,
        });

        await this.transactionalMail.sendTrialStarted({
            to: input.email,
            companyName: input.companyName,
            trialEndsAt: trialEndsAt.toISOString().slice(0, 10),
        });

        return {
            companyId: company.id.toString(),
            trialEndsAt: trialEndsAt.toISOString(),
            mollieCustomerId: customer.id ?? null,
            mollieMandateId: mandate.id ?? null,
        };
    }

    public async runMonthlyBilling(params?: { month?: number; year?: number }): Promise<BillingRunResult> {
        const asOf = this.resolveAsOfDate(params);
        const profiles = await this.billingRepository.getBillableCompanies();
        const pricing = await this.adminRepository.getPricingSettings();
        const defaultPricePerMinute = pricing?.pricePerMinute ?? 0;
        const issuedDate = new Date();
        const dueDate = this.addDays(issuedDate, 7);

        const invoices: BillingRunResult["invoices"] = [];
        let totalAmount = 0;

        for (const profile of profiles) {
            const cycleStart = this.resolveCycleStart(profile);
            if (!cycleStart) {
                continue;
            }

            const lastInvoice = await this.billingRepository.getLastInvoiceForCompany(profile.companyId);
            const periodStart = lastInvoice?.periodEnd
                ? this.addSeconds(lastInvoice.periodEnd, 1)
                : cycleStart;
            const periodEnd = this.addMonths(periodStart, 1);

            // Skip if still in trial window
            if (profile.trialEndsAt && periodEnd <= profile.trialEndsAt) {
                continue;
            }
            // Not due yet
            if (asOf < periodEnd) {
                continue;
            }

            if (profile.trialEndsAt && profile.trialEndsAt <= periodEnd && profile.status === "trial") {
                await this.billingRepository.upsertBillingProfile({
                    companyId: profile.companyId,
                    status: "active",
                });
            }

            const pricePerMinute = profile.pricePerMinute ?? defaultPricePerMinute;
            const usageSeconds = await this.usageRepository.getUsageBetween(
                profile.companyId,
                periodStart,
                periodEnd
            );
            const usageMinutes = Math.ceil(usageSeconds / 60);
            const amount = Number((usageMinutes * pricePerMinute).toFixed(2));
            const invoiceNumber = this.buildInvoiceNumber(profile.companyId, periodStart, periodEnd);

            let paymentId: string | null = null;
            let paymentLink: string | null = null;
            let status = amount === 0 ? "paid" : "pending";

            if (amount > 0 && profile.mollieCustomerId) {
                const payment = await this.createPayment({
                    profile,
                    amount,
                    invoiceNumber,
                    usageMinutes,
                    pricePerMinute,
                });
                paymentId = payment?.id ?? null;
                paymentLink =
                    (payment?._links as any)?.checkout?.href ??
                    (payment?._links as any)?.paymentUrl ??
                    null;
                status = payment?.status ?? "open";
            }

            const invoice = await this.billingRepository.createInvoice({
                invoiceNumber,
                companyId: profile.companyId,
                amount,
                currency: "EUR",
                status,
                issuedDate,
                dueDate,
                usageSeconds,
                pricePerMinute,
                paymentId,
                paymentLink,
                metadata: {
                    usageMinutes,
                    pricePerMinute,
                    billingPeriod: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
                    billingEmail: profile.email,
                    companyName: profile.companyName,
                },
                periodStart,
                periodEnd,
            });

            await this.billingRepository.markCompanyLastBilled(profile.companyId, periodStart);

            invoices.push({
                invoiceNumber,
                companyId: profile.companyId.toString(),
                amount,
                status: invoice.status,
                paymentLink,
                periodStart: periodStart.toISOString(),
                periodEnd: periodEnd.toISOString(),
            });
            totalAmount += amount;

            await this.transactionalMail.sendInvoiceIssued({
                to: profile.email,
                companyName: profile.companyName,
                invoiceNumber,
                amount,
                currency: invoice.currency,
                usageMinutes,
                pricePerMinute,
                dueDate: dueDate.toISOString().slice(0, 10),
                paymentLink,
            });
        }

        return {
            invoicesCreated: invoices.length,
            totalAmount: Number(totalAmount.toFixed(2)),
            invoices,
        };
    }

    public async getInvoice(invoiceNumber: string): Promise<InvoiceRecord | null> {
        return this.billingRepository.getInvoiceByNumber(invoiceNumber);
    }

    public async handleMollieWebhook(paymentId: string): Promise<{ invoice?: InvoiceRecord | null }> {
        if (!paymentId) {
            throw new Error("Missing payment id");
        }
        const payment = await this.mollie.getPayment(paymentId);
        const invoice = await this.billingRepository.findInvoiceByPaymentId(paymentId);
        if (!invoice) {
            return { invoice: null };
        }
        const status = this.mapPaymentStatus(payment);
        await this.billingRepository.updateInvoiceStatus(invoice.invoiceNumber, status, this.extractPaymentLink(payment));

        if (status === "paid") {
            await this.transactionalMail.sendInvoicePaid({
                to: invoice.metadata?.billingEmail ?? undefined,
                companyName: invoice.metadata?.companyName,
                invoiceNumber: invoice.invoiceNumber,
                amount: invoice.amount,
                currency: invoice.currency,
            });
        }

        const refreshed = await this.billingRepository.getInvoiceByNumber(invoice.invoiceNumber);
        return { invoice: refreshed };
    }

    public async upsertBillingProfile(profile: BillingProfileInput): Promise<BillingProfileRecord> {
        return this.billingRepository.upsertBillingProfile(profile);
    }

    private resolveAsOfDate(params?: { month?: number; year?: number }): Date {
        const now = new Date();
        if (Number.isFinite(params?.month) && Number.isFinite(params?.year)) {
            const month = Math.max(1, Math.min(12, Math.floor(params?.month as number)));
            const year = Math.floor(params?.year as number);
            const lastDay = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
            return lastDay;
        }
        return now;
    }

    private async createPayment(params: {
        profile: BillingProfileRecord;
        amount: number;
        invoiceNumber: string;
        usageMinutes: number;
        pricePerMinute: number;
    }): Promise<Payment | null> {
        if (!params.profile.mollieCustomerId) {
            return null;
        }
        const webhookUrl =
            process.env.MOLLIE_WEBHOOK_URL ||
            `${(config.serverUrl || process.env.SERVER_URL || "").replace(/\/+$/, "")}/billing/webhooks/mollie`;
        return this.mollie.createPayment({
            amount: params.amount,
            description: `CallingBird usage invoice ${params.invoiceNumber}`,
            customerId: params.profile.mollieCustomerId,
            mandateId: params.profile.mollieMandateId ?? undefined,
            sequenceType: params.profile.mollieMandateId ? SequenceType.recurring : SequenceType.first,
            webhookUrl,
            metadata: {
                invoiceNumber: params.invoiceNumber,
                companyId: params.profile.companyId.toString(),
                usageMinutes: params.usageMinutes,
                pricePerMinute: params.pricePerMinute,
            },
        });
    }

    private resolveCycleStart(profile: BillingProfileRecord): Date | null {
        if (profile.trialEndsAt) {
            return profile.trialEndsAt;
        }
        if (profile.lastBilledMonth) {
            return profile.lastBilledMonth;
        }
        return profile.companyCreatedAt ?? null;
    }

    private buildInvoiceNumber(companyId: bigint, periodStart: Date, periodEnd: Date): string {
        const startLabel = periodStart.toISOString().slice(0, 10).replace(/-/g, "");
        const endLabel = periodEnd.toISOString().slice(0, 10).replace(/-/g, "");
        const suffix = Date.now().toString().slice(-6);
        return `CB-${companyId.toString()}-${startLabel}-${endLabel}-${suffix}`;
    }

    private addDays(date: Date, days: number): Date {
        const copy = new Date(date.getTime());
        copy.setDate(copy.getDate() + days);
        return copy;
    }

    private addMonths(date: Date, months: number): Date {
        const copy = new Date(date.getTime());
        copy.setMonth(copy.getMonth() + months);
        return copy;
    }

    private addSeconds(date: Date, seconds: number): Date {
        const copy = new Date(date.getTime());
        copy.setSeconds(copy.getSeconds() + seconds);
        return copy;
    }

    private mapPaymentStatus(payment: Payment): string {
        const status = (payment.status as string) ?? "open";
        if (status === "paid" || status === "authorized") return "paid";
        if (status === "pending") return "processing";
        if (status === "expired" || status === "failed" || status === "canceled") return "failed";
        return "pending";
    }

    private extractPaymentLink(payment: Payment): string | null {
        const anyLinks = (payment as any)._links;
        return anyLinks?.checkout?.href || anyLinks?.paymentUrl || null;
    }
}
